import { BILLING_CONFIG } from "../lib/config.js";
import { entitlementService } from "../auth/entitlementService.ts";
import { tokenManager, type TokenManager } from "../auth/tokenManager.ts";
import { SecureStorage } from "../storage/secureStorage.ts";
import { ApiError, errorFromResponse, statusForError } from "./errors.ts";

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
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
    baseUrl = BILLING_CONFIG.apiBaseUrl.replace(/\/$/, ""),
    storage = new SecureStorage(),
  ) {
    this.tokens = tokens;
    this.baseUrl = baseUrl;
    this.storage = storage;
  }

  async request<T = Record<string, unknown>>(
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    return this.perform<T>(path, {
      authenticated: true,
      retryAfterRefresh: true,
      ...options,
    });
  }

  private async perform<T>(path: string, options: RequestOptions): Promise<T> {
    if (!this.baseUrl)
      throw new ApiError(
        "Licensing is unavailable.",
        "BACKEND_NOT_CONFIGURED",
        503,
      );
    const headers: Record<string, string> = { Accept: "application/json" };
    let accessToken: string | undefined;
    if (options.authenticated) {
      const session = await this.storage.getSession();
      if (
        options.requiredEntitlement &&
        !entitlementService.hasCachedFeature(
          session,
          options.requiredEntitlement,
        )
      ) {
        throw new ApiError(
          "Your plan does not include this feature.",
          "ENTITLEMENT_REQUIRED",
          403,
        );
      }
      accessToken = await this.tokens.getAccessToken();
      headers.Authorization = `Bearer ${accessToken}`;
    }
    if (options.body !== undefined)
      headers["Content-Type"] = "application/json";

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: options.method || (options.body === undefined ? "GET" : "POST"),
        headers,
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch {
      throw new ApiError(
        "The server could not be reached.",
        "NETWORK_ERROR",
        0,
      );
    }

    if (response.status === 204) return undefined as T;

    const payload = await response.json().catch(() => ({}));
    const responseError = response.ok
      ? null
      : errorFromResponse(
          response.status,
          payload,
          response.headers.get("Retry-After"),
        );
    if (
      response.status === 401 &&
      options.authenticated &&
      options.retryAfterRefresh &&
      responseError &&
      ["ACCESS_TOKEN_EXPIRED", "INVALID_ACCESS_TOKEN"].includes(
        responseError.code,
      )
    ) {
      await this.tokens.refreshAfterUnauthorized(accessToken || "");
      return this.perform<T>(path, { ...options, retryAfterRefresh: false });
    }
    if (!response.ok) {
      const error = responseError!;
      if (
        options.authenticated &&
        (error.status === 401 || error.status === 403)
      ) {
        const session = await this.storage.getSession();
        if (session) {
          const entitlement =
            typeof error.details?.entitlement === "string"
              ? error.details.entitlement
              : undefined;
          const losesPaidAccess = [
            "LICENSE_EXPIRED",
            "LICENSE_REVOKED",
            "SUBSCRIPTION_INACTIVE",
            "SUBSCRIPTION_EXPIRED",
            "DEVICE_REVOKED",
            "DEVICE_NOT_ACTIVATED",
            "PRODUCT_MISMATCH",
          ].includes(error.code);
          await this.storage.setSession({
            ...session,
            status:
              losesPaidAccess || error.clearsCredentials
                ? statusForError(error)
                : session.status,
            tokens: error.clearsCredentials ? undefined : session.tokens,
            entitlements: session.entitlements
              ? {
                  ...session.entitlements,
                  features: losesPaidAccess
                    ? []
                    : entitlement
                      ? session.entitlements.features.filter(
                          (feature) => feature !== entitlement,
                        )
                      : session.entitlements.features,
                }
              : undefined,
            errorCode: error.code,
          });
        }
      }
      throw error;
    }
    return payload as T;
  }
}

export const apiClient = new ApiClient();
