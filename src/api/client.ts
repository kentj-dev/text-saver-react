import { BILLING_CONFIG } from '../lib/config.js';
import { entitlementService } from '../auth/entitlementService.ts';
import { tokenManager, type TokenManager } from '../auth/tokenManager.ts';
import { SecureStorage } from '../storage/secureStorage.ts';
import { ApiError, errorFromResponse, statusForError } from './errors.ts';

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  authenticated?: boolean;
  requiredEntitlement?: string;
  retryAfterRefresh?: boolean;
};

export class ApiClient {
  private readonly tokens: TokenManager;
  private readonly baseUrl: string;
  private readonly storage: SecureStorage;

  constructor(
    tokens: TokenManager = tokenManager,
    baseUrl = BILLING_CONFIG.apiBaseUrl.replace(/\/$/, ''),
    storage = new SecureStorage(),
  ) {
    this.tokens = tokens;
    this.baseUrl = baseUrl;
    this.storage = storage;
  }

  async request<T = Record<string, unknown>>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.perform<T>(path, { authenticated: true, retryAfterRefresh: true, ...options });
  }

  private async perform<T>(path: string, options: RequestOptions): Promise<T> {
    if (!this.baseUrl) throw new ApiError('Licensing is unavailable.', 'BACKEND_NOT_CONFIGURED', 503);
    const headers: Record<string, string> = { Accept: 'application/json' };
    let accessToken: string | undefined;
    if (options.authenticated) {
      const session = await this.storage.getSession();
      if (options.requiredEntitlement && !entitlementService.hasCachedFeature(session, options.requiredEntitlement)) {
        throw new ApiError('Your plan does not include this feature.', 'ENTITLEMENT_REQUIRED', 403);
      }
      accessToken = await this.tokens.getAccessToken();
      headers.Authorization = `Bearer ${accessToken}`;
    }
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: options.method || (options.body === undefined ? 'GET' : 'POST'),
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch {
      throw new ApiError('The server could not be reached.', 'NETWORK_ERROR', 0);
    }

    const payload = await response.json().catch(() => ({}));
    if (response.status === 401 && options.authenticated && options.retryAfterRefresh) {
      await this.tokens.refreshAfterUnauthorized(accessToken || '');
      return this.perform<T>(path, { ...options, retryAfterRefresh: false });
    }
    if (!response.ok) {
      const error = errorFromResponse(response.status, payload);
      if (options.authenticated && error.isAuthenticationFailure) {
        const session = await this.storage.getSession();
        if (session) {
          await this.storage.setSession({
            ...session, status: statusForError(error), tokens: undefined, errorCode: error.code,
          });
        }
      }
      throw error;
    }
    return payload as T;
  }
}

export const apiClient = new ApiClient();
