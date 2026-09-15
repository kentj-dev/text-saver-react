import { apiClient, type ApiClient } from '../api/client.ts';
import { ApiError, statusForError } from '../api/errors.ts';
import { BILLING_CONFIG } from '../lib/config.js';
import { SecureStorage } from '../storage/secureStorage.ts';
import { deviceManager, type DeviceManager } from './deviceManager.ts';
import { entitlementService, type EntitlementService } from './entitlementService.ts';
import { parseTokenSet } from './tokenManager.ts';
import type { AuthSession, DeviceRegistration } from './types.ts';

type Payload = Record<string, unknown>;

function registration(payload: Payload, fallbackName: string): DeviceRegistration {
  const raw = payload.activation && typeof payload.activation === 'object'
    ? payload.activation as Record<string, unknown>
    : {};
  return {
    deviceId: raw.device_id == null ? undefined : String(raw.device_id),
    deviceName: String(raw.device_name || fallbackName),
    activatedAt: raw.activated_at == null ? undefined : String(raw.activated_at),
    lastSeenAt: raw.last_seen_at == null ? undefined : String(raw.last_seen_at),
  };
}

export class AuthService {
  private readonly storage: SecureStorage;
  private readonly devices: DeviceManager;
  private readonly entitlements: EntitlementService;
  private readonly api: ApiClient;

  constructor(
    storage = new SecureStorage(),
    devices: DeviceManager = deviceManager,
    entitlements: EntitlementService = entitlementService,
    api: ApiClient = apiClient,
  ) {
    this.storage = storage;
    this.devices = devices;
    this.entitlements = entitlements;
    this.api = api;
  }

  async session(): Promise<AuthSession | null> {
    const session = await this.storage.getSession();
    if (session?.status === 'offline_grace' && !this.entitlements.isOfflineGraceAvailable(session)) {
      const expired = { ...session, status: 'expired' as const, tokens: undefined, errorCode: 'OFFLINE_GRACE_EXPIRED' };
      await this.storage.setSession(expired);
      return expired;
    }
    return session;
  }

  async activate(licenseKey: string, requestedDeviceName?: string): Promise<AuthSession> {
    const rawKey = licenseKey.trim();
    if (!rawKey) throw new ApiError('Enter your license key.', 'LICENSE_KEY_REQUIRED', 400);
    const previous = await this.storage.getSession();
    let installation = await this.devices.getOrCreate();
    if (requestedDeviceName?.trim()) installation = await this.devices.rename(requestedDeviceName);
    await this.storage.setSession({
      ...(previous || { schemaVersion: 1, deviceUuid: installation.id, deviceName: installation.name }),
      status: 'activating',
      deviceUuid: installation.id,
      deviceName: installation.name,
      errorCode: undefined,
    });

    try {
      const payload = await this.api.request<Payload>('/licenses/activate', {
        method: 'POST', authenticated: false, retryAfterRefresh: false,
        body: { license_key: rawKey, ...this.devices.activationPayload(installation) },
      });
      const tokens = parseTokenSet(payload);
      const entitlements = this.entitlements.fromPayload(payload);
      const now = Date.now();
      const deviceRegistration = registration(payload, installation.name);
      const activated: AuthSession = {
        schemaVersion: 1, status: 'active', deviceUuid: installation.id,
        deviceName: deviceRegistration.deviceName, registration: deviceRegistration,
        tokens, entitlements, lastValidatedAt: now,
        offlineGraceUntil: this.entitlements.offlineGraceUntil(entitlements, now),
      };
      return this.storage.setSession(activated);
    } catch (error) {
      if (previous) await this.storage.setSession(previous);
      else await this.storage.clearSession();
      throw error;
    }
  }

  async validate(force = false): Promise<AuthSession | null> {
    const existing = await this.session();
    if (!existing?.tokens) return existing;
    if (!force && existing.lastValidatedAt && Date.now() - existing.lastValidatedAt < 12 * 60 * 60 * 1000) return existing;
    try {
      const payload = await this.api.request<Payload>('/licenses/validate', {
        method: 'POST', body: { product: BILLING_CONFIG.productSlug, device_uuid: existing.deviceUuid },
      });
      const entitlements = this.entitlements.fromPayload(payload);
      const now = Date.now();
      return this.storage.setSession({
        ...(await this.storage.getSession() || existing), status: 'active', entitlements,
        lastValidatedAt: now, offlineGraceUntil: this.entitlements.offlineGraceUntil(entitlements, now),
        errorCode: undefined,
      });
    } catch (unknownError) {
      const error = unknownError instanceof ApiError ? unknownError : new ApiError('License validation failed.', 'REQUEST_FAILED', 0);
      const current = await this.storage.getSession() || existing;
      if (error.isTemporary && this.entitlements.isOfflineGraceAvailable(current)) {
        return this.storage.setSession({ ...current, status: 'offline_grace', errorCode: error.code });
      }
      if (error.isTemporary) {
        await this.storage.setSession({ ...current, status: 'expired', errorCode: error.code });
      }
      if (!error.isTemporary) {
        await this.storage.setSession({ ...current, status: statusForError(error), tokens: undefined, errorCode: error.code });
      }
      throw error;
    }
  }

  async deactivate(): Promise<void> {
    const session = await this.storage.getSession();
    if (!session) return;
    try {
      await this.api.request('/licenses/deactivate', {
        method: 'POST', body: { product: BILLING_CONFIG.productSlug, device_uuid: session.deviceUuid },
      });
    } catch (error) {
      if (!(error instanceof ApiError) || error.isTemporary) throw error;
    }
    await this.storage.clearSession();
  }

  async logoutLocal(): Promise<void> {
    await this.storage.clearSession();
  }
}

export const authService = new AuthService();
