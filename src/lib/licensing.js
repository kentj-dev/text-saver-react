import { ApiError } from '../api/errors.ts';
import { deviceManager, INSTALLATION_KEY } from '../auth/deviceManager.ts';
import { AUTH_SESSION_KEY } from '../storage/secureStorage.ts';
import { getPlanLimits } from './plans.js';

export { INSTALLATION_KEY };
export const LICENSE_KEY = AUTH_SESSION_KEY;
export const LICENSING_MESSAGE = 'text-saver:licensing';
export const VALIDATION_INTERVAL_MS = 12 * 60 * 60 * 1000;
export const OFFLINE_GRACE_MS = 3 * 24 * 60 * 60 * 1000;
export const LicenseApiError = ApiError;

export function licenseView(session) {
  if (!session) return null;
  return {
    installationId: session.deviceUuid,
    deviceName: session.deviceName,
    product: session.entitlements?.product,
    plan: session.entitlements?.plan,
    features: session.entitlements?.features || [],
    billingType: session.entitlements?.billingType,
    licenseStatus: session.entitlements?.licenseStatus,
    expiresAt: session.entitlements?.expiresAt,
    maxDevices: session.entitlements?.maxDevices,
    activeDevices: session.entitlements?.activeDevices,
    activation: session.registration,
    planId: session.entitlements?.features?.includes('cloud_sync') ? 'plus' : 'free',
    status: session.status,
    lastValidatedAt: session.lastValidatedAt,
    offlineValidUntil: session.offlineGraceUntil,
    validationError: session.errorCode,
  };
}

export async function getInstallation() {
  return deviceManager.getOrCreate();
}

export async function getStoredLicense() {
  return invokeLicensing('getLicense');
}

export async function clearStoredLicense() {
  return invokeLicensing('clearLocal');
}

export function effectivePlanId(license, now = Date.now()) {
  if (!license || !license.features?.includes('cloud_sync')) return 'free';
  if (license.status === 'active' || license.status === 'refreshing') return 'plus';
  if (license.status === 'offline_grace' && Number(license.offlineValidUntil) > now) return 'plus';
  return 'free';
}

export async function activateLicense(licenseKey, deviceName) {
  return invokeLicensing('activate', { licenseKey, deviceName });
}

export async function validateLicense({ force = false } = {}) {
  return invokeLicensing('validate', { force });
}

export async function ensureActiveLicense() {
  let license = await getStoredLicense();
  if (!license) throw new ApiError('Activate Plus to use cloud sync.', 'AUTH_REQUIRED', 401);
  if (!license.lastValidatedAt || Date.now() - license.lastValidatedAt >= VALIDATION_INTERVAL_MS) {
    license = await validateLicense({ force: true });
  }
  if (!license || effectivePlanId(license) !== 'plus') {
    throw new ApiError('Cloud sync requires an active Plus license.', 'ENTITLEMENT_REQUIRED', 403);
  }
  return license;
}

export async function licenseApiRequest(path, _license, body) {
  // The license argument is intentionally ignored. A bearer token is attached
  // centrally, and the server validates product/device/entitlement per route.
  return invokeLicensing('request', body === undefined ? { path } : { path, body });
}

export async function deactivateInstallation(_license, clearLocal = true) {
  if (clearLocal) return invokeLicensing('logout');
  // After a replacement activation the old device token is no longer present.
  // The server's device-management UI must be used to free that old slot.
}

export async function listDevices() {
  return invokeLicensing('listDevices');
}

export async function deactivateDevice(id) {
  return invokeLicensing('deactivateDevice', { id });
}

export async function revokeDevice(id) {
  return invokeLicensing('revokeDevice', { id });
}

function canMessageServiceWorker() {
  return typeof chrome?.runtime?.sendMessage === 'function';
}

function restoreError(error) {
  return new ApiError(error?.message || 'Licensing request failed.', error?.code || 'REQUEST_FAILED', error?.status || 0, error?.details);
}

async function invokeLicensing(action, payload = {}) {
  if (typeof globalThis.__TEXT_SAVER_LICENSING_SERVICE__ === 'function') {
    return globalThis.__TEXT_SAVER_LICENSING_SERVICE__(action, payload);
  }
  if (!canMessageServiceWorker()) {
    // Node tests and the browser-only Vite preview do not have an MV3 worker.
    const service = await import('../auth/licensingService.ts');
    return service.runLicensingCommand(action, payload);
  }
  const response = await chrome.runtime.sendMessage({ type: LICENSING_MESSAGE, action, payload });
  if (!response?.ok) throw restoreError(response?.error);
  return response.result;
}

export function currentPlan(license) {
  return getPlanLimits(effectivePlanId(license));
}
