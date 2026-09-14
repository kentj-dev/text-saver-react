import { BILLING_CONFIG } from './config.js';
import { DEFAULT_PLAN_ID, getPlanLimits } from './plans.js';

export const INSTALLATION_KEY = 'text_saver_installation';
export const LICENSE_KEY = 'text_saver_license';
export const VALIDATION_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export class LicenseApiError extends Error {
  constructor(message, code = 'request_failed', status = 0, details = undefined) {
    super(message);
    this.name = 'LicenseApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function normalizeBaseUrl() {
  return BILLING_CONFIG.apiBaseUrl.replace(/\/$/, '');
}

async function apiRequest(path, { method = 'POST', body, token, headers = {}, responseType = 'json' } = {}) {
  const baseUrl = normalizeBaseUrl();
  if (!baseUrl) {
    throw new LicenseApiError('The licensing backend has not been configured yet.', 'backend_not_configured', 503);
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined || body instanceof ArrayBuffer ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : body instanceof ArrayBuffer ? body : JSON.stringify(body),
  });
  if (!response.ok) {
    let payload;
    try { payload = await response.json(); } catch (_error) { payload = {}; }
    throw new LicenseApiError(
      payload.message || `Request failed (${response.status})`,
      payload.code || 'request_failed',
      response.status,
      payload.details,
    );
  }
  if (responseType === 'response') return response;
  if (response.status === 204) return null;
  return response.json();
}

export async function getInstallation() {
  const stored = await chrome.storage.local.get(INSTALLATION_KEY);
  if (stored[INSTALLATION_KEY]?.id) return stored[INSTALLATION_KEY];
  const platform = await chrome.runtime.getPlatformInfo().catch(() => ({ os: 'unknown' }));
  const id = crypto.randomUUID();
  const installation = {
    id,
    name: `Chrome on ${platform.os || 'this device'} • ${id.slice(0, 6).toUpperCase()}`,
    createdAt: new Date().toISOString(),
  };
  await chrome.storage.local.set({ [INSTALLATION_KEY]: installation });
  return installation;
}

export async function getStoredLicense() {
  const stored = await chrome.storage.local.get(LICENSE_KEY);
  const license = stored[LICENSE_KEY] || null;
  if (!license?.licenseKey) return license;
  // Version 6 never persists the reusable customer key. Strip legacy records
  // immediately; the Laravel activation flow will replace it with a scoped token.
  const {
    licenseKey: _discardedKey,
    sessionToken: _discardedSession,
    sessionExpiresAt: _discardedExpiry,
    ...legacyLicense
  } = license;
  const safeLicense = {
    ...legacyLicense,
    status: 'invalid',
    validationError: 'reauthentication_required',
  };
  await chrome.storage.local.set({ [LICENSE_KEY]: safeLicense });
  return safeLicense;
}

export async function storeLicense(license) {
  const { licenseKey: _discardedKey, ...safeLicense } = license;
  await chrome.storage.local.set({ [LICENSE_KEY]: safeLicense });
  return safeLicense;
}

export async function clearStoredLicense() {
  await chrome.storage.local.remove(LICENSE_KEY);
}

export function effectivePlanId(license, now = Date.now()) {
  if (!license || !['plus', 'pro'].includes(license.planId)) return DEFAULT_PLAN_ID;
  // Legacy Pro test entitlements map to the single paid plan.
  if (license.status === 'active') return 'plus';
  if (license.status === 'offline' && Number(license.offlineValidUntil) > now) return 'plus';
  return DEFAULT_PLAN_ID;
}

function entitlementRecord(payload, installation, previous = {}) {
  const now = Date.now();
  const { licenseKey: _discardedKey, ...safePrevious } = previous;
  const installationToken = payload.installationToken || safePrevious.installationToken;
  if (!installationToken) {
    throw new LicenseApiError(
      'The backend did not issue an installation token.',
      'backend_contract_error',
      502,
    );
  }
  return {
    ...safePrevious,
    licenseId: payload.licenseId || safePrevious.licenseId,
    licenseFingerprint: payload.licenseFingerprint || safePrevious.licenseFingerprint,
    installationToken,
    installationId: installation.id,
    deviceName: installation.name,
    instanceId: payload.instanceId,
    planId: 'plus',
    status: 'active',
    activation: payload.activation,
    activationLimit: payload.activationLimit,
    lastValidatedAt: now,
    offlineValidUntil: now + OFFLINE_GRACE_MS,
    sessionToken: payload.sessionToken,
    sessionExpiresAt: payload.sessionExpiresAt,
  };
}

export async function activateLicense(licenseKey, deviceName) {
  const installation = await getInstallation();
  const normalizedKey = licenseKey.trim();
  const name = deviceName.trim() || installation.name;
  const payload = await apiRequest('/v1/licenses/activate', {
    body: { licenseKey: normalizedKey, installationId: installation.id, deviceName: name },
  });
  const updatedInstallation = { ...installation, name };
  await chrome.storage.local.set({ [INSTALLATION_KEY]: updatedInstallation });
  return storeLicense(entitlementRecord(payload, updatedInstallation));
}

export async function validateLicense({ force = false } = {}) {
  const license = await getStoredLicense();
  if (!license) return null;
  const now = Date.now();
  if (!force && license.lastValidatedAt && now - license.lastValidatedAt < VALIDATION_INTERVAL_MS) return license;
  try {
    if (!license.installationToken) {
      throw new LicenseApiError(
        'Reactivate once to replace the legacy stored key with a secure installation token.',
        'reauthentication_required',
        401,
      );
    }
    const payload = await apiRequest('/v1/licenses/validate', {
      body: {
        installationId: license.installationId,
        instanceId: license.instanceId,
      },
      token: license.installationToken,
    });
    return storeLicense(entitlementRecord(payload, {
      id: license.installationId,
      name: license.deviceName,
    }, license));
  } catch (error) {
    const definitiveCodes = new Set([
      'license_revoked',
      'license_expired',
      'license_not_found',
      'license_inactive',
      'installation_not_found',
      'installation_inactive',
      'unknown_product',
      'reauthentication_required',
    ]);
    const definitive = error instanceof LicenseApiError && definitiveCodes.has(error.code);
    const next = {
      ...license,
      status: definitive || Number(license.offlineValidUntil) <= now ? 'invalid' : 'offline',
      sessionToken: definitive ? undefined : license.sessionToken,
      sessionExpiresAt: definitive ? undefined : license.sessionExpiresAt,
      validationError: error.code || 'network_error',
    };
    await storeLicense(next);
    if (definitive) throw error;
    return next;
  }
}

export async function ensureSessionToken() {
  let license = await getStoredLicense();
  if (!license) throw new LicenseApiError('Activate a Plus license first.', 'license_required', 401);
  if (!license.sessionToken || Number(license.sessionExpiresAt) <= Date.now() + 60000) {
    license = await validateLicense({ force: true });
  }
  if (!license?.sessionToken || effectivePlanId(license) !== 'plus') {
    throw new LicenseApiError('Cloud sync requires an active Plus license.', 'plus_required', 403);
  }
  return license;
}

export async function listLicenseDevices(license) {
  if (!license?.installationToken) {
    throw new LicenseApiError('Reactivate this installation first.', 'reauthentication_required', 401);
  }
  return apiRequest('/v1/licenses/devices', {
    body: { installationId: license.installationId },
    token: license.installationToken,
  });
}

export async function deactivateInstallation(license, installationId = license?.installationId, clearLocal = true) {
  if (!license) return;
  if (!license.installationToken) {
    throw new LicenseApiError('Reactivate this installation first.', 'reauthentication_required', 401);
  }
  await apiRequest('/v1/licenses/deactivate', {
    body: { installationId },
    token: license.installationToken,
  });
  if (clearLocal && installationId === license.installationId) await clearStoredLicense();
}

export function currentPlan(license) {
  return getPlanLimits(effectivePlanId(license));
}

export { apiRequest };
