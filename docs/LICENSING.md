# Client licensing architecture

The extension is an untrusted client. Its JavaScript and `chrome.storage` data can be inspected or modified, so local checks only decide what the interface displays. The backend decides whether a premium operation is authorized.

## Components

- `src/auth/deviceManager.ts` creates one random installation UUID and reuses it. Its optional public-key field reserves the activation contract for future device-bound signing.
- `src/storage/secureStorage.ts` stores revocable device credentials in `chrome.storage.local`, removes legacy raw-license records, and documents the limits of browser storage.
- `src/auth/authService.ts` owns activation, validation, deactivation, local logout, state transitions, and customer-facing session behavior.
- `src/auth/tokenManager.ts` owns access-token expiry, mandatory refresh-token rotation, and the single in-flight refresh promise.
- `src/auth/entitlementService.ts` normalizes cached entitlement metadata and bounds offline use.
- `src/api/client.ts` attaches bearer tokens, refreshes after a 401, retries once, prevents refresh loops, and clears credentials after server revocation.
- `src/lib/licensing.js` is a temporary compatibility facade for the existing popup and cloud-sync modules. It does not contain authentication logic.

## Activation and storage

Activation posts to `/api/v1/licenses/activate`:

```json
{
  "license_key": "AST-…",
  "product": "text-saver",
  "device_uuid": "random-persisted-uuid",
  "device_name": "Chrome on macOS"
}
```

The response must contain `access_token`, `refresh_token`, token expiry information, and entitlement data for `text-saver`. The input key is never placed in React state beyond the activation form, logs, URLs, alarms, or persistent storage. After activation, storage contains only the installation record and a revocable auth session.

## Authenticated requests and rotation

All protected requests go through `ApiClient` and send `Authorization: Bearer <access_token>`. Feature modules never receive or attach refresh tokens. If an access token is near expiry or a request returns 401, `TokenManager` posts the refresh token to `/api/v1/auth/refresh`.

Only one refresh promise can exist. Concurrent requests in one context await it, while a Web Lock coordinates the popup and MV3 service worker contexts. A refresh response must contain a different refresh token; both new tokens replace the previous pair in one storage write before callers retry. Each API request can retry only once.

If the backend reports a revoked device, license, token family, expired license, or expired subscription, credentials are cleared and a specific inactive state is retained for the interface. Network and server failures never become permanent authorization.

## States and customer messages

Persistent/session states are `inactive`, `activating`, `active`, `refreshing`, `offline_grace`, `expired`, `revoked`, `device_revoked`, and `subscription_expired`. UI code translates backend codes into customer actions; it does not expose token-family or HTTP details.

Examples:

- `TOKEN_FAMILY_REVOKED` → “Your session has expired. Please activate this device again.”
- `LICENSE_DEVICE_LIMIT_EXCEEDED` → “You've reached your device limit. Deactivate an old device to activate this one.”
- `DEVICE_REVOKED` → “This device was deactivated. Activate it again to restore access.”

## Entitlements and offline behavior

Cached entitlements can hide or enable local-only controls. They are not proof of authorization. Cloud sync and every other server-backed premium route must independently validate the bearer token, active device, active license/subscription, product, and required feature on the backend.

After successful server validation, local-only features receive at most three days of offline grace. Grace is capped by the entitlement expiration timestamp and never applies to an already expired or revoked session. Server-backed features still fail while offline. When connectivity returns, normal API use or scheduled validation revalidates the session.

High-value functionality should remain behind server APIs where practical. Fully local premium limits are inherently patchable and should not be presented as tamper-proof licensing.

## Deactivation and logout

Deactivation calls the authenticated `/api/v1/licenses/deactivate` route and clears local credentials after the server releases the device. A temporary network failure preserves credentials so a paid device slot is not silently orphaned. `logoutLocal()` is available for an explicit local-only sign-out flow and makes no claim that the server device was released.

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
