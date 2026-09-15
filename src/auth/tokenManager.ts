import { BILLING_CONFIG } from '../lib/config.js';
import { ApiError, errorFromResponse, statusForError } from '../api/errors.ts';
import { SecureStorage } from '../storage/secureStorage.ts';
import { entitlementService } from './entitlementService.ts';
import type { AuthSession, TokenPayload, TokenSet } from './types.ts';

const EXPIRY_LEEWAY_MS = 30_000;

function timestamp(value: unknown): number | undefined {
  if (typeof value === 'number') return value > 10_000_000_000 ? value : value * 1000;
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric > 10_000_000_000 ? numeric : numeric * 1000;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function parseTokenSet(payload: Record<string, unknown>, previousRefreshToken?: string): TokenSet {
  const source = (payload.tokens && typeof payload.tokens === 'object'
    ? payload.tokens
    : payload) as TokenPayload;
  const accessToken = source.access_token;
  const refreshToken = source.refresh_token;
  if (!accessToken) {
    throw new ApiError('The licensing server returned incomplete device credentials.', 'BACKEND_CONTRACT_ERROR', 502);
  }
  if (!refreshToken) {
    throw new ApiError(
      previousRefreshToken ? 'The server did not rotate the refresh token.' : 'The licensing server returned incomplete device credentials.',
      previousRefreshToken ? 'ROTATION_REQUIRED' : 'BACKEND_CONTRACT_ERROR',
      previousRefreshToken ? 401 : 502,
    );
  }
  if (previousRefreshToken && refreshToken === previousRefreshToken) {
    throw new ApiError('The server did not rotate the refresh token.', 'ROTATION_REQUIRED', 401);
  }
  const expiresIn = Number(source.expires_in);
  return {
    accessToken,
    refreshToken,
    accessTokenExpiresAt: timestamp(source.access_token_expires_at)
      || Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 15 * 60 * 1000),
    refreshTokenExpiresAt: timestamp(source.refresh_token_expires_at),
  };
}

export class TokenManager {
  private refreshFlight: Promise<TokenSet> | null = null;
  private readonly storage: SecureStorage;

  constructor(storage = new SecureStorage()) {
    this.storage = storage;
  }

  async getAccessToken(): Promise<string> {
    const session = await this.storage.getSession();
    if (!session?.tokens) throw new ApiError('Activate Plus to continue.', 'AUTH_REQUIRED', 401);
    if (session.tokens.accessTokenExpiresAt > Date.now() + EXPIRY_LEEWAY_MS) {
      return session.tokens.accessToken;
    }
    return (await this.refresh()).accessToken;
  }

  async refresh(): Promise<TokenSet> {
    if (this.refreshFlight) return this.refreshFlight;
    this.refreshFlight = this.coordinateRefresh().finally(() => {
      this.refreshFlight = null;
    });
    return this.refreshFlight;
  }

  async refreshAfterUnauthorized(rejectedAccessToken: string): Promise<TokenSet> {
    if (this.refreshFlight) return this.refreshFlight;
    const current = await this.storage.getSession();
    if (!current?.tokens) throw new ApiError('Activate Plus to continue.', 'AUTH_REQUIRED', 401);
    // Another request may already have completed a rotation before this 401 was
    // handled. In that case retry with the new access token, without refreshing again.
    if (current.tokens.accessToken !== rejectedAccessToken) return current.tokens;
    if (this.refreshFlight) return this.refreshFlight;
    return this.refresh();
  }

  private async coordinateRefresh(): Promise<TokenSet> {
    const expected = await this.storage.getSession();
    if (!expected?.tokens?.refreshToken) throw new ApiError('Activate Plus to continue.', 'AUTH_REQUIRED', 401);
    const execute = async () => {
      const current = await this.storage.getSession();
      if (!current?.tokens) throw new ApiError('Activate Plus to continue.', 'AUTH_REQUIRED', 401);
      // Web Locks coalesces refreshes across the popup and MV3 service worker.
      // The second context observes the already-rotated token and skips its call.
      if (current.tokens.refreshToken !== expected.tokens?.refreshToken) return current.tokens;
      return this.performRefresh(current);
    };
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
    if (locks) {
      return locks.request('text-saver-auth-refresh', { mode: 'exclusive' }, execute);
    }
    return execute();
  }

  private async performRefresh(session: AuthSession): Promise<TokenSet> {
    if (!session.tokens?.refreshToken) throw new ApiError('Activate Plus to continue.', 'AUTH_REQUIRED', 401);
    await this.storage.setSession({ ...session, status: 'refreshing', errorCode: undefined });

    let response: Response;
    try {
      response = await fetch(`${BILLING_CONFIG.apiBaseUrl.replace(/\/$/, '')}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          product: BILLING_CONFIG.productSlug,
          device_uuid: session.deviceUuid,
          refresh_token: session.tokens.refreshToken,
        }),
      });
    } catch {
      const error = new ApiError('The licensing server could not be reached.', 'NETWORK_ERROR', 0);
      await this.recordRefreshFailure(session, error);
      throw error;
    }

    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      const error = errorFromResponse(response.status, payload);
      await this.recordRefreshFailure(session, error);
      throw error;
    }

    let tokens: TokenSet;
    try {
      tokens = parseTokenSet(payload, session.tokens.refreshToken);
    } catch (unknownError) {
      const error = unknownError instanceof ApiError
        ? unknownError
        : new ApiError('The session could not be renewed safely.', 'ROTATION_REQUIRED', 401);
      await this.recordRefreshFailure(session, error);
      throw error;
    }
    const current = await this.storage.getSession();
    if (!current) throw new ApiError('Activate Plus to continue.', 'AUTH_REQUIRED', 401);
    if (!current.tokens) throw new ApiError('Activate Plus to continue.', 'AUTH_REQUIRED', 401);
    if (current.tokens?.refreshToken !== session.tokens.refreshToken) return current.tokens;
    let entitlements = current.entitlements;
    try {
      if (payload.entitlements || payload.license) entitlements = entitlementService.fromPayload(payload);
    } catch (unknownError) {
      const error = unknownError instanceof ApiError
        ? unknownError
        : new ApiError('The entitlement response was invalid.', 'BACKEND_CONTRACT_ERROR', 502);
      await this.recordRefreshFailure(session, error);
      throw error;
    }
    const now = Date.now();
    await this.storage.setSession({
      ...current,
      status: 'active',
      tokens, // Atomic replacement: the rotated refresh token supersedes the old one.
      entitlements,
      lastValidatedAt: now,
      offlineGraceUntil: entitlements ? entitlementService.offlineGraceUntil(entitlements, now) : current.offlineGraceUntil,
      errorCode: undefined,
    });
    return tokens;
  }

  private async recordRefreshFailure(session: AuthSession, error: ApiError): Promise<void> {
    if (error.isTemporary && entitlementService.isOfflineGraceAvailable(session)) {
      await this.storage.setSession({ ...session, status: 'offline_grace', errorCode: error.code });
      return;
    }
    if (error.isTemporary) {
      await this.storage.setSession({ ...session, status: 'expired', errorCode: error.code });
      return;
    }
    await this.storage.setSession({
      ...session,
      status: statusForError(error),
      tokens: undefined,
      errorCode: error.code,
    });
  }
}

export const tokenManager = new TokenManager();
