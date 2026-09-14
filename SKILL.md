---
name: creem-licensing-integration
description: Connect an app sold through Creem (Chrome extension, desktop app, or web app) to the central licensing API. Use when adding license key entry, device activation, license validation, paywalled features, device limits, subscription expiry handling, or per-license cloud sync.
---

# Creem licensing integration

This app is sold through Creem, but it must never call Creem directly. A central Laravel licensing API receives Creem's webhooks, and it is the only service the app talks to.

- API base URL: `{{API_BASE_URL}}`
- API origin (for extension host permissions): `{{APP_URL}}`

Before writing code:

1. If either value above still shows a `{{...}}` placeholder, ask the user for their licensing API URL.
2. Ask for the **product slug** (for example `text-saver`) unless the codebase already defines one. It must match a product created in the licensing dashboard, which also needs a plan mapped to the Creem product ID.

## Rules

- Talk only to the licensing API. Never add Creem API keys, checkout secrets, or the webhook secret to the app.
- Generate `device_id` once per installation with `crypto.randomUUID()` (or the platform equivalent) and persist it locally. Never derive it from IP addresses, user agents, or hardware fingerprints, and never sync it between devices.
- Store the license key locally for this installation and trim whitespace before sending it.
- The server decides whether a license is valid. Use `expires_at` for display, not to lock or unlock features on the device.
- Treat `404`, `403`, `409`, and `413` as definite answers. Treat network failures, `429`, and `5xx` as temporary: keep the last successful validation for a limited offline grace period (3 days is a sensible default) and retry later.
- Every endpoint is `POST` with a JSON body. Send `Content-Type: application/json` and `Accept: application/json`.

## API reference

Every request includes `product`, `license_key`, and `device_id` (8–255 characters from `A-Z a-z 0-9 . _ : -`). Responses never contain database or Creem IDs.

| Endpoint               | Extra fields                                                                                      | Success response                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `/licenses/activate`   | Optional `device_name` (255), `platform` (50), `app_version` (50)                                 | `{ activated: true, license, activation }`                        |
| `/licenses/validate`   | —                                                                                                 | `{ valid: true, license, activation }`                            |
| `/licenses/deactivate` | —                                                                                                 | `{ deactivated: true }`                                           |
| `/sync/pull`           | —                                                                                                 | `{ revision, data, size_bytes, checksum, updated_at, max_bytes }` |
| `/sync/push`           | `revision` (integer, the last pulled or pushed revision, `0` at first), `data` (non-empty string) | `{ revision, size_bytes, checksum, updated_at, max_bytes }`       |

`license` is `{ product, plan, billing_type: "subscription" | "lifetime", status: "active" | "expired" | "revoked", expires_at: ISO 8601 | null, max_devices, active_devices }`.

`activation` is `{ device_id, device_name, activated_at, last_seen_at }`.

Behavior to rely on:

- Activating an already active device is idempotent and doesn't use another slot.
- Validate and sync require the device to be activated first.
- Deactivating is idempotent and works after the license expires.
- Subscription licenses stay valid for a grace period (48 hours by default) after the paid period ends. Lifetime licenses have `expires_at: null`.
- Sync stores one opaque string per license, shared by all its active devices, up to `max_bytes` bytes (5 MB). A license that never synced pulls `revision: 0` and `data: null`.
- Expired licenses can still pull sync data but can't push. Revoked licenses can do neither.

## Errors

Error bodies are `{ "error": "<code>", "message": "<text>" }`. Validate errors also include `"valid": false`.

| Status | `error`                     | Meaning                                                           | App behavior                                   |
| ------ | --------------------------- | ----------------------------------------------------------------- | ---------------------------------------------- |
| 404    | `invalid_license`           | Unknown key, key for another product, or unknown/inactive product | Ask the customer to check the key              |
| 403    | `license_expired`           | Subscription ended and grace period passed                        | Lock paid features, show a renew link          |
| 403    | `license_revoked`           | Refunded or revoked                                               | Lock paid features                             |
| 403    | `device_not_activated`      | Device isn't active on this license                               | Offer to activate this device again            |
| 409    | `device_limit_reached`      | All device slots are used                                         | Tell the customer to deactivate another device |
| 409    | `sync_conflict`             | Another device pushed first; body includes `revision`             | Pull, merge, push with the pulled revision     |
| 413    | `sync_quota_exceeded`       | Data larger than the limit; body includes `max_bytes`             | Tell the customer or reduce synced data        |
| 429    | `too_many_attempts` or none | Rate limited; respect `Retry-After`                               | Retry later, keep last known result            |
| 422    | none                        | Invalid request; body has `message` and `errors`                  | Fix the request                                |

Rate limits: 60 requests per minute per IP, 30 sync requests per minute per license key, and 10 unknown keys per 15 minutes per IP.

## Implementation steps

1. Find where the app stores settings and where paid features are gated. Reuse the app's existing storage, UI components, and state patterns.
2. Add one licensing client module that owns the base URL, product slug, device ID, HTTP calls, and error mapping. Use the reference client below and adapt the storage calls to the platform.
3. Build license key entry: an input, an Activate button with a loading state, messages mapped from `error` codes, and after success the plan, status, expiry, and `active_devices` of `max_devices`.
4. Validate when the app starts and on a schedule (every 6–12 hours). Gate paid features on the result of `checkLicense()`, not on stored flags alone.
5. Add "Remove license" (or sign-out) that calls deactivate and then clears the stored license.
6. If the app syncs data, pull before the first edit in a session, push with the last known revision, resolve `sync_conflict` by merging, and handle `sync_quota_exceeded`.
7. For Chrome extensions (Manifest V3), add `"permissions": ["storage", "alarms"]` and `"host_permissions": ["{{APP_URL}}/*"]`, and run scheduled validation from the service worker with `chrome.alarms`.

## Reference client

Adapt the storage calls (`chrome.storage.local` here) to the platform. Keep the error handling semantics.

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
    max_devices: number;
    active_devices: number;
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

async function post<T>(
    path: string,
    body: Record<string, unknown>,
): Promise<T> {
    let response: Response;

    try {
        response = await fetch(`${API_BASE_URL}${path}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body: JSON.stringify({ product: PRODUCT, ...body }),
        });
    } catch {
        throw new LicensingError(
            0,
            "network_error",
            "The licensing server could not be reached.",
        );
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

export async function activateLicense(licenseKey: string): Promise<License> {
    const key = licenseKey.trim();
    const { license } = await post<{ license: License }>("/licenses/activate", {
        license_key: key,
        device_id: await getDeviceId(),
        app_version: chrome.runtime.getManifest().version,
    });

    await chrome.storage.local.set({
        licenseKey: key,
        license,
        checkedAt: Date.now(),
    });

    return license;
}

// Returns the license to trust right now, or null when paid features should be locked.
export async function checkLicense(): Promise<License | null> {
    const { licenseKey, license, checkedAt } = await chrome.storage.local.get([
        "licenseKey",
        "license",
        "checkedAt",
    ]);

    if (typeof licenseKey !== "string") {
        return null;
    }

    try {
        const result = await post<{ license: License }>("/licenses/validate", {
            license_key: licenseKey,
            device_id: await getDeviceId(),
        });

        await chrome.storage.local.set({
            license: result.license,
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

        await chrome.storage.local.remove(["license", "checkedAt"]);

        return null;
    }
}

export async function deactivateLicense(): Promise<void> {
    const { licenseKey } = await chrome.storage.local.get("licenseKey");

    if (typeof licenseKey === "string") {
        await post("/licenses/deactivate", {
            license_key: licenseKey,
            device_id: await getDeviceId(),
        });
    }

    await chrome.storage.local.remove(["licenseKey", "license", "checkedAt"]);
}

export async function pushSyncData(
    localData: string,
    merge: (remote: string | null, local: string) => string,
): Promise<number> {
    const { licenseKey, syncRevision } = await chrome.storage.local.get([
        "licenseKey",
        "syncRevision",
    ]);
    const deviceId = await getDeviceId();
    let revision = typeof syncRevision === "number" ? syncRevision : 0;
    let data = localData;

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const result = await post<{ revision: number }>("/sync/push", {
                license_key: licenseKey,
                device_id: deviceId,
                revision,
                data,
            });
            await chrome.storage.local.set({ syncRevision: result.revision });

            return result.revision;
        } catch (error) {
            if (
                !(error instanceof LicensingError) ||
                error.code !== "sync_conflict"
            ) {
                throw error;
            }

            const remote = await post<{
                revision: number;
                data: string | null;
            }>("/sync/pull", { license_key: licenseKey, device_id: deviceId });
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

- [ ] A valid key activates, unlocks paid features, and shows device usage.
- [ ] A wrong key shows a clear message and doesn't retry in a loop.
- [ ] Activating the same device again doesn't use another slot.
- [ ] Starting offline within the grace period keeps features; after it, features lock.
- [ ] Expired licenses show a renewal message; revoked licenses lock features.
- [ ] Removing the license frees the slot, so another device can activate.
- [ ] With sync: two devices editing produce a conflict that resolves by merging, and oversized data is handled.
- [ ] Searching the built app finds no Creem API keys or webhook secrets.

To create a test license without a purchase, the user can send a signed test `checkout.completed` webhook. The licensing dashboard's documentation page explains how, under "Test without a real purchase".
