import { BILLING_CONFIG } from './config.js';
import { DEFAULT_PLAN_ID, getPlanLimits } from './plans.js';

export const INSTALLATION_KEY = 'text_saver_installation';
export const LICENSE_KEY = 'text_saver_license';
export const VALIDATION_INTERVAL_MS = 12 * 60 * 60 * 1000;
export const OFFLINE_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

export class LicenseApiError extends Error {
  constructor(message, code = 'request_failed', status = 0, details = undefined) {
    super(message);
    this.name = 'LicenseApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  get isTemporary() {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

function normalizeBaseUrl() {
  return BILLING_CONFIG.apiBaseUrl.replace(/\/$/, '');
}

async function post(path, body) {
  const baseUrl = normalizeBaseUrl();
  if (!baseUrl) {
    throw new LicenseApiError('The licensing backend has not been configured yet.', 'backend_not_configured', 503);
  }

  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ product: BILLING_CONFIG.productSlug, ...body }),
    });
  } catch (_error) {
    throw new LicenseApiError('The licensing server could not be reached.', 'network_error', 0);
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new LicenseApiError(
      payload.message || `Request failed (${response.status})`,
      payload.error || `http_${response.status}`,
      response.status,
      payload,
    );
  }
  return payload;
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
  if (!license) return null;

  // Older prerelease builds stored bearer tokens instead of the license key
  // required by the central licensing API. They must activate once again.
  if (!license.licenseKey) {
    const migrated = {
      installationId: license.installationId,
      deviceName: license.deviceName,
      planId: license.planId,
      status: 'invalid',
      validationError: 'reauthentication_required',
    };
    await chrome.storage.local.set({ [LICENSE_KEY]: migrated });
    return migrated;
  }

  return license;
}

export async function storeLicense(license) {
  await chrome.storage.local.set({ [LICENSE_KEY]: license });
  return license;
}

export async function clearStoredLicense() {
  await chrome.storage.local.remove(LICENSE_KEY);
}

export function effectivePlanId(license, now = Date.now()) {
  if (!license || !['plus', 'pro'].includes(license.planId)) return DEFAULT_PLAN_ID;
  if (license.status === 'active') return 'plus';
  if (license.status === 'offline' && Number(license.offlineValidUntil) > now) return 'plus';
  return DEFAULT_PLAN_ID;
}

function entitlementRecord(payload, installation, licenseKey, previous = {}) {
  const serverLicense = payload?.license;
  const activation = payload?.activation;
  if (!serverLicense || serverLicense.product !== BILLING_CONFIG.productSlug) {
    throw new LicenseApiError(
      'The licensing backend returned an invalid product entitlement.',
      'backend_contract_error',
      502,
      payload,
    );
  }

  const now = Date.now();
  return {
    ...previous,
    licenseKey,
    installationId: installation.id,
    deviceName: activation?.device_name || installation.name,
    product: serverLicense.product,
    plan: serverLicense.plan,
    billingType: serverLicense.billing_type,
    licenseStatus: serverLicense.status,
    expiresAt: serverLicense.expires_at,
    maxDevices: serverLicense.max_devices,
    activeDevices: serverLicense.active_devices,
    activation: activation ? {
      deviceId: activation.device_id,
      deviceName: activation.device_name,
      activatedAt: activation.activated_at,
      lastSeenAt: activation.last_seen_at,
    } : previous.activation,
    planId: 'plus',
    status: 'active',
    lastValidatedAt: now,
    offlineValidUntil: now + OFFLINE_GRACE_MS,
    validationError: undefined,
  };
}

function credentials(license) {
  if (!license?.licenseKey) {
    throw new LicenseApiError(
      'Enter the license key again to connect this installation.',
      'reauthentication_required',
      401,
    );
  }
  return {
    license_key: license.licenseKey.trim(),
    device_id: license.installationId,
  };
}

export async function activateLicense(licenseKey, deviceName) {
  const installation = await getInstallation();
  const normalizedKey = licenseKey.trim();
  const name = deviceName.trim() || installation.name;
  const platform = await chrome.runtime.getPlatformInfo().catch(() => ({ os: 'unknown' }));
  const payload = await post('/licenses/activate', {
    license_key: normalizedKey,
    device_id: installation.id,
    device_name: name,
    platform: platform.os || 'unknown',
    app_version: chrome.runtime.getManifest().version,
  });
  const updatedInstallation = { ...installation, name };
  await chrome.storage.local.set({ [INSTALLATION_KEY]: updatedInstallation });
  return storeLicense(entitlementRecord(payload, updatedInstallation, normalizedKey));
}

export async function validateLicense({ force = false } = {}) {
  const license = await getStoredLicense();
  if (!license) return null;
  const now = Date.now();
  if (!force && license.lastValidatedAt && now - license.lastValidatedAt < VALIDATION_INTERVAL_MS) return license;

  try {
    const payload = await post('/licenses/validate', credentials(license));
    if (payload.valid !== true) {
      throw new LicenseApiError('The license is not valid.', 'invalid_license', 403, payload);
    }
    return storeLicense(entitlementRecord(payload, {
      id: license.installationId,
      name: license.deviceName,
    }, license.licenseKey, license));
  } catch (error) {
    const typed = error instanceof LicenseApiError
      ? error
      : new LicenseApiError('License validation failed.', 'request_failed', 0);
    const canUseOfflineGrace = typed.isTemporary && Number(license.offlineValidUntil) > now;
    const next = {
      ...license,
      status: canUseOfflineGrace ? 'offline' : 'invalid',
      validationError: typed.code,
    };
    await storeLicense(next);
    if (!typed.isTemporary) throw typed;
    return next;
  }
}

export async function ensureActiveLicense() {
  let license = await getStoredLicense();
  if (!license) throw new LicenseApiError('Activate a Plus license first.', 'license_required', 401);
  if (!license.lastValidatedAt || Date.now() - license.lastValidatedAt >= VALIDATION_INTERVAL_MS) {
    license = await validateLicense({ force: true });
  }
  if (!license || effectivePlanId(license) !== 'plus') {
    throw new LicenseApiError('Cloud sync requires an active Plus license.', 'plus_required', 403);
  }
  return license;
}

export async function licenseApiRequest(path, license, body = {}) {
  return post(path, { ...credentials(license), ...body });
}

export async function deactivateInstallation(license, clearLocal = true) {
  if (!license) return;
  await post('/licenses/deactivate', credentials(license));
  if (clearLocal) await clearStoredLicense();
}

export function currentPlan(license) {
  return getPlanLimits(effectivePlanId(license));
}
