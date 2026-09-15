---
name: creem-licensing-integration
description: Connect an app sold through Creem (Chrome extension, desktop app, or web app) to the central licensing API. Use when adding license key entry, device activation, access and refresh tokens, paywalled features, entitlements, device limits and device management, subscription expiry handling, or per-license cloud sync.
---

# Creem licensing integration

This app is sold through Creem, but it must never call Creem directly. A central Laravel licensing API receives Creem's webhooks, and it is the only service the app talks to.

- API base URL: `{{API_BASE_URL}}`
- API origin (for extension host permissions): `{{APP_URL}}`

Before writing code:

1. If either value above still shows a `{{...}}` placeholder, ask the user for their licensing API URL.
2. Ask for the **product slug** (for example `text-saver`) unless the codebase already defines one. It must match a product created in the licensing dashboard, which also needs a plan mapped to the Creem product ID.
3. Ask which **entitlement keys** gate which features (for example `cloud_sync`, `export`) unless the codebase already defines them. They must match the plan's entitlements in the dashboard.

## Rules

- Talk only to the licensing API. Never add Creem API keys, checkout secrets, or the webhook secret to the app.
- **Send the customer's license key to `/licenses/activate` and nowhere else, then drop it.** Never persist it. It is not a login and works on any device, forever.
- Activation and refresh return an `access_token` (30 minutes) and a `refresh_token` (30 days). Persist the tokens, the access token's expiry time, `device_id`, and the last `license` and `entitlements` for display and offline grace.
- **Refresh tokens are single-use.** Save the new pair from every refresh response before anything else. Presenting a refresh token a second time signs the device out (`401 refresh_token_reused`).
- **Only one refresh may run at a time.** Route every licensing call through one module with a shared in-flight refresh promise. In a Chrome extension, run that module only in the service worker and message it from the popup and content scripts.
- Send the access token only as `Authorization: Bearer <access_token>`. Never log tokens, never put them in URLs, and clear them when the user signs out.
- Generate `device_id` once per installation with `crypto.randomUUID()` (or the platform equivalent) and persist it. Never derive it from IP addresses, user agents, or hardware fingerprints, and never sync it between devices.
- The server decides what is unlocked. Gate UI on `entitlements`, not on plan names or `expires_at`, and never treat a client-side flag as the only protection for a server-backed feature.
- Treat `401` and `403` as definite answers. Treat network failures, `429`, and `5xx` as temporary: keep the last successful license check for a limited offline grace period (3 days is a sensible default) and retry later.

## API reference

Send `Accept: application/json`, plus `Content-Type: application/json` when there is a body. Responses never contain license keys, customer details, or database and Creem IDs; a device's `id` is the only identifier.

### Getting tokens

`POST /licenses/activate`, the only endpoint that accepts `license_key`:

```json
{
  "product": "text-saver",
  "license_key": "AST-TS-XXXX-XXXX-XXXX",
  "device_id": "550e8400-...",
  "device_name": "Chrome on MacBook Pro",
  "platform": "mac",
  "app_version": "6.0.0"
}
```

`device_id` is 8–255 characters from `A-Z a-z 0-9 . _ : -`. `device_name` (255), `platform` (50), and `app_version` (50) are optional. Optional `public_key` (base64 DER SPKI) is stored for future device-bound authentication.

`POST /auth/refresh` with `{ "refresh_token": "lrt_..." }`.

Both return:

```json
{
  "token_type": "Bearer",
  "access_token": "lat_...",
  "expires_in": 1800,
  "refresh_token": "lrt_...",
  "refresh_token_expires_in": 2592000,
  "license": {
    "product": "text-saver",
    "plan": "Pro Monthly",
    "billing_type": "subscription",
    "status": "active",
    "expires_at": "2026-10-14T10:00:00+00:00",
    "subscription": {
      "status": "active",
      "current_period_end": "2026-10-14T10:00:00+00:00"
    },
    "max_devices": 2,
    "active_devices": 1
  },
  "entitlements": ["cloud_sync", "export"],
  "device": {
    "id": "0199a3e4-...",
    "device_name": "Chrome on MacBook Pro",
    "platform": "mac",
    "app_version": "6.0.0",
    "activated_at": "2026-09-14T10:00:00+00:00",
    "last_seen_at": "2026-09-14T10:00:00+00:00"
  }
}
```

Activating an already active device doesn't use another slot but ends its previous tokens. Refresh works after a license expires (to show renewal), not after it is revoked or the device is deactivated.

### Authenticated endpoints (access token)

| Endpoint                    | Body                                                     | Success response                                                  |
| --------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------- |
| `GET /license`              | —                                                        | `{ license, entitlements, device }`                               |
| `GET /license/entitlements` | —                                                        | `{ active, reason, plan, entitlements }`                          |
| `GET /devices`              | —                                                        | `{ max_devices, devices: [device + is_current] }`                 |
| `DELETE /devices/{id}`      | —                                                        | `204`; that device is signed out and may activate again           |
| `POST /devices/{id}/revoke` | —                                                        | `204`; that installation can never activate again                 |
| `POST /auth/logout`         | —                                                        | `204`; this device is signed out and its slot freed               |
| `POST /sync/pull`           | —                                                        | `{ revision, data, size_bytes, checksum, updated_at, max_bytes }` |
| `POST /sync/push`           | `revision` (last pulled or pushed, `0` at first), `data` | `{ revision, size_bytes, checksum, updated_at, max_bytes }`       |

Behavior to rely on:

- `GET /license` reports expired licenses with `status: "expired"` and `entitlements: []` instead of refusing them.
- `reason` in `/license/entitlements` is `null`, `license_expired`, `license_revoked`, or `subscription_inactive` (paused, unpaid, or canceled).
- Subscription licenses stay valid for a grace period (48 hours by default) after the paid period ends. Lifetime licenses have `expires_at: null` and `subscription: null`.
- Sync requires the `cloud_sync` entitlement. It stores one opaque string per license, shared by its active devices, up to `max_bytes` bytes (5 MB). Expired licenses can pull but not push.
- A device can't revoke itself; use logout. Device IDs from another license return `404 not_found`.

## Errors

Error bodies are `{ "error": "<code>", "message": "<text>" }`. They never echo the license key or tokens.

| Status | `error`                        | Meaning                                                           | App behavior                                         |
| ------ | ------------------------------ | ----------------------------------------------------------------- | ---------------------------------------------------- |
| 401    | `access_token_expired`         | Access token older than 30 minutes                                | Refresh once, retry the request                      |
| 401    | `invalid_access_token`         | Missing or unknown access token                                   | Refresh if a refresh token exists, else sign in      |
| 401    | `session_revoked`              | Signed out, deactivated, or reactivated elsewhere                 | Clear tokens, ask for the license key                |
| 401    | `invalid_refresh_token`        | Unknown or expired refresh token                                  | Clear tokens, ask for the license key                |
| 401    | `refresh_token_reused`         | A refresh token was used twice; all device tokens ended           | Clear tokens, ask for the license key                |
| 404    | `invalid_license`              | Unknown key, key for another product, or unknown/inactive product | Ask the customer to check the key                    |
| 404    | `not_found`                    | Device ID not on this license                                     | Reload the device list                               |
| 403    | `license_expired`              | Subscription ended and grace period passed                        | Lock paid features, show a renew link                |
| 403    | `license_revoked`              | Refunded or revoked                                               | Clear tokens, lock paid features                     |
| 403    | `subscription_inactive`        | Subscription paused, unpaid, or canceled                          | Lock paid features, link to billing                  |
| 403    | `entitlement_missing`          | Plan lacks the feature; body includes `entitlement`               | Offer an upgrade                                     |
| 403    | `device_not_activated`         | Device lost its slot, or `device_id` doesn't match                | Offer to activate this device again                  |
| 403    | `device_revoked`               | The customer revoked this installation                            | Clear tokens; tell the customer                      |
| 403    | `product_mismatch`             | Token belongs to another product                                  | Fix the product slug                                 |
| 409    | `device_limit_reached`         | All device slots are used                                         | Show the device list so the customer can free a slot |
| 409    | `cannot_revoke_current_device` | A device tried to revoke itself                                   | Use logout                                           |
| 409    | `sync_conflict`                | Another device pushed first; body includes `revision`             | Pull, merge, push with the pulled revision           |
| 413    | `sync_quota_exceeded`          | Data larger than the limit; body includes `max_bytes`             | Tell the customer or reduce synced data              |
| 429    | `too_many_attempts` or none    | Rate limited; respect `Retry-After`                               | Retry later, keep last known result                  |
| 422    | none                           | Invalid request; body has `message` and `errors`                  | Fix the request                                      |

Rate limits: 60 requests per minute per IP, 10 activations per minute per IP, 5 attempts per minute per refresh token, 120 requests per minute per device, 30 sync requests per minute per device, and 10 unknown keys or refresh tokens per 15 minutes per IP.

## Implementation steps

1. Find where the app stores settings and where paid features are gated. Reuse the app's existing storage, UI components, and state patterns.
2. Add one licensing client module that owns the base URL, product slug, device ID, token storage, single-flight refresh, HTTP calls, and error mapping. Use the reference client below and adapt the storage calls to the platform.
3. Build license key entry: an input, an Activate button with a loading state, messages mapped from `error` codes, and after success the plan, status, expiry, and `active_devices` of `max_devices`. The input value must not be written to storage.
4. Check `GET /license` when the app starts and on a schedule (every 6–12 hours). Gate features on the returned `entitlements`.
5. Add a device list (`GET /devices`) with Deactivate and Revoke actions, and show it when activation fails with `device_limit_reached`.
6. Add "Sign out" (or "Remove license") that calls `/auth/logout` and then clears the stored tokens and cached license.
7. If the app syncs data and the plan includes `cloud_sync`, pull before the first edit in a session, push with the last known revision, resolve `sync_conflict` by merging, and handle `sync_quota_exceeded`.
8. For Chrome extensions (Manifest V3), add `"permissions": ["storage", "alarms"]` and `"host_permissions": ["{{APP_URL}}/*"]`, keep the licensing module in the service worker, and run scheduled checks with `chrome.alarms`.

## Reference client

Adapt the storage calls (`chrome.storage.local` here) to the platform. Keep the refresh and error handling semantics.

```ts
const API_BASE_URL = "{{API_BASE_URL}}";
const PRODUCT = "your-product-slug";
const OFFLINE_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

export type License = {
  product: string;
  plan: string;
  billing_type: "subscription" | "lifetime";
  status: "active" | "expired" | "revoked";
  expires_at: string | null;
  subscription: { status: string; current_period_end: string | null } | null;
  max_devices: number;
  active_devices: number;
};

export type Device = {
  id: string;
  device_name: string | null;
  platform: string | null;
  app_version: string | null;
  activated_at: string;
  last_seen_at: string | null;
  is_current?: boolean;
};

type Session = {
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken: string;
};

type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  license: License;
  entitlements: string[];
};

export class LicensingError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }

  get isTemporary(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

async function request<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  options: { body?: Record<string, unknown>; accessToken?: string } = {},
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.accessToken
          ? { Authorization: `Bearer ${options.accessToken}` }
          : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new LicensingError(
      0,
      "network_error",
      "The licensing server could not be reached.",
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const json = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new LicensingError(
      response.status,
      json.error ?? `http_${response.status}`,
      json.message ?? response.statusText,
      json,
    );
  }

  return json as T;
}

export async function getDeviceId(): Promise<string> {
  const { deviceId } = await chrome.storage.local.get("deviceId");

  if (typeof deviceId === "string") {
    return deviceId;
  }

  const newDeviceId = crypto.randomUUID();
  await chrome.storage.local.set({ deviceId: newDeviceId });

  return newDeviceId;
}

async function storedSession(): Promise<Session | null> {
  const { session } = await chrome.storage.local.get("session");

  return (session as Session | undefined) ?? null;
}

async function saveTokens(tokens: TokenResponse): Promise<Session> {
  const session: Session = {
    accessToken: tokens.access_token,
    accessTokenExpiresAt: Date.now() + tokens.expires_in * 1000,
    refreshToken: tokens.refresh_token,
  };

  await chrome.storage.local.set({
    session,
    license: tokens.license,
    entitlements: tokens.entitlements,
    checkedAt: Date.now(),
  });

  return session;
}

async function clearLocalLicense(): Promise<void> {
  await chrome.storage.local.remove([
    "session",
    "license",
    "entitlements",
    "checkedAt",
    "syncRevision",
  ]);
}

// The license key is used once and never stored.
export async function activateLicense(licenseKey: string): Promise<License> {
  const tokens = await request<TokenResponse>("POST", "/licenses/activate", {
    body: {
      product: PRODUCT,
      license_key: licenseKey.trim(),
      device_id: await getDeviceId(),
      device_name: "Chrome",
      app_version: chrome.runtime.getManifest().version,
    },
  });

  await saveTokens(tokens);

  return tokens.license;
}

let refreshing: Promise<Session | null> | null = null;

// Exchanges the refresh token exactly once, however many callers need a new access token.
function refreshSession(stale: Session): Promise<Session | null> {
  refreshing ??= (async () => {
    try {
      const current = await storedSession();

      // Another caller already rotated the tokens; a used refresh token must never be sent again.
      if (current === null || current.refreshToken !== stale.refreshToken) {
        return current;
      }

      return await saveTokens(
        await request<TokenResponse>("POST", "/auth/refresh", {
          body: { refresh_token: stale.refreshToken },
        }),
      );
    } catch (error) {
      if (error instanceof LicensingError && !error.isTemporary) {
        await clearLocalLicense();

        return null;
      }

      throw error;
    } finally {
      refreshing = null;
    }
  })();

  return refreshing;
}

export async function authorized<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  let session = await storedSession();

  if (session !== null && session.accessTokenExpiresAt - 60_000 < Date.now()) {
    session = await refreshSession(session);
  }

  if (session === null) {
    throw new LicensingError(
      401,
      "session_revoked",
      "This device is not signed in.",
    );
  }

  try {
    return await request<T>(method, path, {
      body,
      accessToken: session.accessToken,
    });
  } catch (error) {
    if (
      !(error instanceof LicensingError) ||
      error.code !== "access_token_expired"
    ) {
      throw error;
    }

    const refreshed = await refreshSession(session);

    if (refreshed === null) {
      throw error;
    }

    return request<T>(method, path, {
      body,
      accessToken: refreshed.accessToken,
    });
  }
}

// Returns the license to trust right now, or null when paid features should be locked.
export async function checkLicense(): Promise<License | null> {
  const { license, checkedAt } = await chrome.storage.local.get([
    "license",
    "checkedAt",
  ]);

  try {
    const result = await authorized<{
      license: License;
      entitlements: string[];
    }>("GET", "/license");
    await chrome.storage.local.set({
      license: result.license,
      entitlements: result.entitlements,
      checkedAt: Date.now(),
    });

    return result.license;
  } catch (error) {
    if (error instanceof LicensingError && error.isTemporary) {
      const isWithinGrace =
        typeof checkedAt === "number" &&
        Date.now() - checkedAt < OFFLINE_GRACE_MS;

      return isWithinGrace ? (license as License) : null;
    }

    if (error instanceof LicensingError && error.status === 401) {
      await clearLocalLicense();
    }

    return null;
  }
}

// For UI only; the server re-checks entitlements on every premium request.
export async function hasEntitlement(entitlement: string): Promise<boolean> {
  const { entitlements } = await chrome.storage.local.get("entitlements");

  return Array.isArray(entitlements) && entitlements.includes(entitlement);
}

export async function listDevices(): Promise<{
  max_devices: number;
  devices: Device[];
}> {
  return authorized("GET", "/devices");
}

export async function deactivateDevice(id: string): Promise<void> {
  await authorized("DELETE", `/devices/${encodeURIComponent(id)}`);
}

export async function revokeDevice(id: string): Promise<void> {
  await authorized("POST", `/devices/${encodeURIComponent(id)}/revoke`);
}

export async function signOut(): Promise<void> {
  try {
    await authorized("POST", "/auth/logout");
  } catch (error) {
    // Any definite answer means this device is already signed out or can't continue.
    if (error instanceof LicensingError && error.isTemporary) {
      throw error;
    }
  }

  await clearLocalLicense();
}

export async function pushSyncData(
  localData: string,
  merge: (remote: string | null, local: string) => string,
): Promise<number> {
  const { syncRevision } = await chrome.storage.local.get("syncRevision");
  let revision = typeof syncRevision === "number" ? syncRevision : 0;
  let data = localData;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await authorized<{ revision: number }>(
        "POST",
        "/sync/push",
        { revision, data },
      );
      await chrome.storage.local.set({ syncRevision: result.revision });

      return result.revision;
    } catch (error) {
      if (
        !(error instanceof LicensingError) ||
        error.code !== "sync_conflict"
      ) {
        throw error;
      }

      const remote = await authorized<{
        revision: number;
        data: string | null;
      }>("POST", "/sync/pull");
      revision = remote.revision;
      data = merge(remote.data, localData);
    }
  }

  throw new Error(
    "Sync kept conflicting with another device. Try again later.",
  );
}
```

## Verify before finishing

- [ ] Searching the built app and its storage finds no license key after activation, only the tokens and `device_id`.
- [ ] `license_key` is sent only to `/licenses/activate`; every other call uses `Authorization: Bearer <access_token>` or, for refresh, the refresh token body.
- [ ] Every refresh response's tokens replace the stored ones before any other request, and concurrent requests trigger only one refresh.
- [ ] After 30 minutes the app refreshes silently; after `session_revoked`, `invalid_refresh_token`, or `refresh_token_reused` it asks for the license key instead of retrying.
- [ ] A valid key activates, unlocks the plan's entitlements, and shows device usage.
- [ ] A wrong key shows a clear message and doesn't retry in a loop.
- [ ] `device_limit_reached` shows the device list, and deactivating a device there lets this one activate.
- [ ] Starting offline within the grace period keeps features; after it, features lock.
- [ ] Expired licenses show a renewal message; revoked licenses and inactive subscriptions lock features.
- [ ] Signing out frees the slot, so another device can activate.
- [ ] With sync: two devices editing produce a conflict that resolves by merging, and oversized data is handled.
- [ ] Searching the built app finds no Creem API keys, webhook secrets, or the license key pepper.

To create a test license without a purchase, the user can send a signed test `checkout.completed` webhook. The licensing dashboard's documentation page explains how, under "Test without a real purchase".
