import { BILLING_CONFIG } from '../lib/config.js';
import { DEFAULT_PLAN_ID } from '../lib/plans.js';
import type { AuthSession, Entitlements } from './types.ts';
import { ApiError, customerMessage } from '../api/errors.ts';

const DEFAULT_OFFLINE_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

function strings(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, enabled]) => enabled === true)
      .map(([feature]) => feature);
  }
  return [];
}

export class EntitlementService {
  readonly offlineGraceMs = DEFAULT_OFFLINE_GRACE_MS;

  fromPayload(payload: Record<string, unknown>): Entitlements {
    const license = payload.license && typeof payload.license === 'object' && !Array.isArray(payload.license)
      ? payload.license as Record<string, unknown>
      : {};
    const entitlementObject = payload.entitlements
      && typeof payload.entitlements === 'object'
      && !Array.isArray(payload.entitlements)
      ? payload.entitlements as Record<string, unknown>
      : {};
    const raw = { ...license, ...entitlementObject };
    if (!Object.keys(raw).length) {
      throw new ApiError('The licensing server returned incomplete entitlement data.', 'BACKEND_CONTRACT_ERROR', 502);
    }

    const product = String(raw.product || payload.product || '');
    if (product !== BILLING_CONFIG.productSlug) {
      throw new ApiError(customerMessage('PRODUCT_MISMATCH'), 'PRODUCT_MISMATCH', 403);
    }

    const plan = String(raw.plan || raw.plan_id || DEFAULT_PLAN_ID).toLowerCase();
    const features = strings(raw.features ?? raw.feature_flags ?? payload.entitlements);
    // Older Plus responses may omit the feature list. The value is only a UI
    // cache; protected endpoints still enforce the entitlement on the server.
    if (['plus', 'pro'].includes(plan) && !features.includes('cloud_sync')) features.push('cloud_sync');

    const result: Entitlements = {
      product,
      plan: plan === 'pro' ? 'plus' : plan,
      features,
      licenseStatus: typeof raw.status === 'string' ? raw.status : undefined,
      billingType: raw.billing_type === 'subscription' ? 'subscription' : raw.billing_type === 'lifetime' ? 'lifetime' : undefined,
      expiresAt: raw.expires_at == null ? null : String(raw.expires_at),
      maxDevices: Number.isFinite(Number(raw.max_devices)) ? Number(raw.max_devices) : undefined,
      activeDevices: Number.isFinite(Number(raw.active_devices)) ? Number(raw.active_devices) : undefined,
    };
    if (payload.valid === false) throw new ApiError(customerMessage('INVALID_LICENSE'), 'INVALID_LICENSE', 403);
    const status = result.licenseStatus?.toLowerCase();
    if (status === 'revoked') throw new ApiError(customerMessage('LICENSE_REVOKED'), 'LICENSE_REVOKED', 403);
    if (status === 'expired') throw new ApiError(customerMessage('LICENSE_EXPIRED'), 'LICENSE_EXPIRED', 403);
    if (result.expiresAt && Date.parse(result.expiresAt) <= Date.now()) {
      const code = result.billingType === 'subscription' ? 'SUBSCRIPTION_EXPIRED' : 'LICENSE_EXPIRED';
      throw new ApiError(customerMessage(code), code, 403);
    }
    return result;
  }

  offlineGraceUntil(entitlements: Entitlements, validatedAt = Date.now()): number {
    const normalLimit = validatedAt + this.offlineGraceMs;
    if (!entitlements.expiresAt) return normalLimit;
    const entitlementExpiry = Date.parse(entitlements.expiresAt);
    return Number.isFinite(entitlementExpiry) ? Math.min(normalLimit, entitlementExpiry) : normalLimit;
  }

  isOfflineGraceAvailable(session: AuthSession | null, now = Date.now()): boolean {
    return Boolean(
      session?.entitlements
      && Number(session.offlineGraceUntil) > now
      && ['active', 'refreshing', 'offline_grace'].includes(session.status),
    );
  }

  hasCachedFeature(session: AuthSession | null, feature: string, now = Date.now()): boolean {
    if (!session?.entitlements) return false;
    const usable = session.status === 'active' || session.status === 'refreshing'
      || (session.status === 'offline_grace' && this.isOfflineGraceAvailable(session, now));
    return usable && session.entitlements.features.includes(feature);
  }

  effectivePlanId(session: AuthSession | null, now = Date.now()): string {
    if (!session?.entitlements || !['plus', 'pro'].includes(session.entitlements.plan)) return DEFAULT_PLAN_ID;
    if (session.status === 'active' || session.status === 'refreshing') return 'plus';
    if (session.status === 'offline_grace' && this.isOfflineGraceAvailable(session, now)) return 'plus';
    return DEFAULT_PLAN_ID;
  }
}

export const entitlementService = new EntitlementService();
