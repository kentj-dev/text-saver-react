# Client licensing architecture

The extension is an untrusted client. Its JavaScript and `chrome.storage` data can be inspected or modified, so local checks only decide what the interface displays. The backend decides whether a premium operation is authorized.

## Components

- `src/auth/deviceManager.ts` creates one random installation UUID and reuses it. Its optional public-key field reserves the activation contract for future device-bound signing.
- `src/storage/secureStorage.ts` stores revocable device credentials in `chrome.storage.local`, removes legacy raw-license records, and documents the limits of browser storage.
- `src/auth/authService.ts` owns activation, license checks, logout, state transitions, and customer-facing session behavior.
- `src/auth/tokenManager.ts` owns access-token expiry, mandatory refresh-token rotation, and the single in-flight refresh promise.
- `src/auth/entitlementService.ts` normalizes cached entitlement metadata and bounds offline use.
- `src/api/client.ts` attaches bearer tokens, refreshes only for expired/invalid access tokens, retries once, prevents refresh loops, and applies definite 401/403 state changes.
- `src/auth/licensingService.ts` is loaded by the service worker and owns every licensing API operation.
- `src/lib/licensing.js` is the popup/service-worker message facade and contains no token or fetch logic.

## Activation and storage

Activation posts to `/api/v1/licenses/activate`:

```json
{
  "license_key": "AST-…",
  "product": "text-saver",
  "device_id": "random-persisted-uuid",
  "device_name": "Chrome on macOS",
  "platform": "mac",
  "app_version": "6.0.0"
}
```

The response must contain `access_token`, `refresh_token`, token expiry information, and entitlement data for `text-saver`. The input key is never placed in React state beyond the activation form, logs, URLs, alarms, or persistent storage. After activation, storage contains only the installation record and a revocable auth session.

## Authenticated requests and rotation

All protected requests go through `ApiClient` in the MV3 service worker and send `Authorization: Bearer <access_token>`. Popup and feature modules never receive or attach tokens. If an access token is near expiry, or the backend specifically returns `access_token_expired`/`invalid_access_token`, `TokenManager` posts only the refresh token to `/api/v1/auth/refresh`.

Only one refresh promise can exist in the service worker. A refresh response must contain a different refresh token; both new tokens replace the previous pair in one storage write before response metadata is processed or callers retry. Each API request can retry only once.

Revoked sessions/devices and invalid or reused refresh tokens clear credentials. Expired and inactive subscriptions keep the session metadata needed to show renewal/billing guidance but receive no paid entitlements. Network, rate-limit, and server failures use only the bounded offline grace window.

## States and customer messages

Persistent/session states are `inactive`, `activating`, `active`, `refreshing`, `offline_grace`, `offline_locked`, `expired`, `revoked`, `device_revoked`, `subscription_inactive`, and `subscription_expired`. `offline_locked` disables Plus locally after grace without discarding credentials, so a later online check can recover automatically. UI code translates backend codes into customer actions; it does not expose token-family or HTTP details.

Examples:

- `refresh_token_reused` → “Your session ended because its security token was reused. Please activate this device again.”
- `device_limit_reached` → “You've reached your device limit. Deactivate an old device to activate this one.”
- `device_revoked` → “This device was deactivated. Activate it again to restore access.”

## Entitlements and offline behavior

Cached entitlements can hide or enable local-only controls. Plan display names never unlock features; Plus behavior is enabled by the `cloud_sync` entitlement. Cached data is not proof of authorization. Cloud sync and every other server-backed premium route must independently validate the bearer token, active device, active license/subscription, product, and required feature on the backend.

After successful server validation, local-only features receive at most three days of offline grace. Grace is capped by the entitlement expiration timestamp and never applies to an already expired or revoked session. Server-backed features still fail while offline. When connectivity returns, normal API use or scheduled validation revalidates the session.

High-value functionality should remain behind server APIs where practical. Fully local premium limits are inherently patchable and should not be presented as tamper-proof licensing.

## Devices and logout

The device panel uses `GET /api/v1/devices`, `DELETE /api/v1/devices/{id}`, and `POST /api/v1/devices/{id}/revoke`. Revocation is clearly presented as permanent and is disabled for the current device. Signing out calls `/api/v1/auth/logout` and clears local credentials only after the server releases the slot; a temporary failure preserves credentials so a slot is not silently orphaned.

## Chrome-extension security notes

- Manifest V3 and extension isolation do not make shipped code or local storage secret.
- No payment-provider secret, backend private key, database credential, or signing private key belongs in the bundle, manifest, source, or shipped environment variables.
- Host permissions are limited to the licensing API origin.
- Avoid logging license keys or tokens. Keep them out of query strings and DOM attributes.
- Treat XSS in an extension page as credential compromise; retain the default Content Security Policy and avoid remote code/eval.
- Tokens should be short-lived, audience/product scoped, revocable, and rate-limited by the backend.
- A future device private key should be generated automatically, remain non-exportable when platform APIs permit, and never require customer key management.

## Backend contract required by this client

The backend remains responsible for secure activation, token hashing/storage, refresh-token reuse detection and family revocation, device limits, entitlement checks, subscription/webhook state, abuse controls, and audit logging. The client cannot make those controls secure on its own.
