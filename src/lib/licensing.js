// Compatibility facade for the existing popup/background modules. All token,
// refresh, storage, and state transitions live in the typed auth/api services.
import { apiClient } from '../api/client.ts';
import { ApiError } from '../api/errors.ts';
import { authService } from '../auth/authService.ts';
import { deviceManager, INSTALLATION_KEY } from '../auth/deviceManager.ts';
import { entitlementService } from '../auth/entitlementService.ts';
import { AUTH_SESSION_KEY } from '../storage/secureStorage.ts';
import { getPlanLimits } from './plans.js';

export { INSTALLATION_KEY };
export const LICENSE_KEY = AUTH_SESSION_KEY;
export const VALIDATION_INTERVAL_MS = 12 * 60 * 60 * 1000;
export const OFFLINE_GRACE_MS = entitlementService.offlineGraceMs;
export const LicenseApiError = ApiError;

function view(session) {
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
    planId: session.entitlements?.plan === 'pro' ? 'plus' : session.entitlements?.plan || 'free',
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
  return view(await authService.session());
}

export async function clearStoredLicense() {
  return authService.logoutLocal();
}

export function effectivePlanId(license, now = Date.now()) {
  if (!license || !['plus', 'pro'].includes(license.planId)) return 'free';
  if (license.status === 'active' || license.status === 'refreshing') return 'plus';
  if (license.status === 'offline_grace' && Number(license.offlineValidUntil) > now) return 'plus';
  return 'free';
}

export async function activateLicense(licenseKey, deviceName) {
  return view(await authService.activate(licenseKey, deviceName));
}

export async function validateLicense({ force = false } = {}) {
  return view(await authService.validate(force));
}

export async function ensureActiveLicense() {
  let session = await authService.session();
  if (!session?.tokens) throw new ApiError('Activate Plus to use cloud sync.', 'AUTH_REQUIRED', 401);
  if (!session.lastValidatedAt || Date.now() - session.lastValidatedAt >= VALIDATION_INTERVAL_MS) {
    session = await authService.validate(true);
  }
  if (!session || entitlementService.effectivePlanId(session) !== 'plus') {
    throw new ApiError('Cloud sync requires an active Plus license.', 'ENTITLEMENT_REQUIRED', 403);
  }
  return view(session);
}

export async function licenseApiRequest(path, _license, body = {}) {
  // The license argument is intentionally ignored. A bearer token is attached
  // centrally, and the server validates product/device/entitlement per route.
  return apiClient.request(path, {
    method: 'POST', body,
    requiredEntitlement: path.startsWith('/sync/') ? 'cloud_sync' : undefined,
  });
}

export async function deactivateInstallation(_license, clearLocal = true) {
  if (clearLocal) return authService.deactivate();
  // After a replacement activation the old device token is no longer present.
  // The server's device-management UI must be used to free that old slot.
}

export function currentPlan(license) {
  return getPlanLimits(effectivePlanId(license));
}
