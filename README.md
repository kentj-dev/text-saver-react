# Text Saver React extension

This is the React 19 conversion of Text Saver. It keeps the existing Chrome note-storage keys, state schema, and encrypted-tab format so it can replace the current popup without losing user notes. It can also read the previous whole-state cloud format and migrate it to selective tab sync.

The paid offering is a single **Plus** lifetime plan at **$2.99**: 20 tabs, 20,000 characters and 10,000 lines per tab, a 5 MiB local-state ceiling, and client-side encrypted sync for up to five selected tabs across two activated devices.

Cloud selection belongs to the license, not an individual installation. After activating the same license on another device, the user enters the same sync password and the selected tabs are copied into that device without replacing its local-only tabs. The special Context Menu inbox always remains local.

The Laravel `/api/v1/sync/pull` and `/api/v1/sync/push` endpoints store one opaque string per license. The string contains a versioned, client-encrypted envelope; Laravel never receives the sync password or plaintext notes. Revision numbers provide optimistic conflict detection across devices.

## Stack

- React 19 + Vite
- Tailwind CSS
- Shadcn-style local UI components backed by Radix UI
- Lucide React icons
- `react-sortablejs` for tab ordering
- Driver.js for the first-run and replayable product tour
- Self-hosted Montserrat through `@fontsource/montserrat`

## Frontend structure

- `src/App.tsx` is the composition root only.
- `src/context/TextSaverProvider.tsx` owns application orchestration and exposes a typed interface through `TextSaverContext`.
- `src/components` owns layout, section, and repeated item components.
- `src/hooks` contains reusable UI behavior; `src/lib` contains storage, licensing, sync, and pure helpers.

## Develop and build

```sh
npm install
npm run dev
npm run build
```

Development mode provides an in-memory Chrome API shim so the popup can also be reviewed in a normal browser at the Vite URL. Data in that preview is temporary; real extension testing still uses the built `dist` folder.

Load `react-extension/dist` as an unpacked extension from `chrome://extensions`.

The build copies `public/manifest.json` and icons into `dist`. Montserrat is bundled by Vite from `@fontsource/montserrat`.

## Laravel licensing integration

The extension is configured for:

- API base URL: `https://apps.hamiken.com/api/v1`
- Product slug: `text-saver`
- Host permission: `https://apps.hamiken.com/*`

Activation sends the customer-entered license key once with the product, persisted installation ID, friendly device name, platform, and app version. A successful response must return a 30-minute access token, a rotating 30-day refresh token, license metadata, and entitlements. The raw license key is then discarded and is never stored or sent again.

All network authentication runs in the Manifest V3 service worker. Popup code uses extension messages; it never handles bearer or refresh tokens. The centralized API client refreshes expired access tokens through `/auth/refresh`, persists the newly rotated pair before doing anything else, coalesces concurrent refresh attempts, and retries only an expired/invalid access-token request once. The extension calls:

- `/licenses/activate`
- `/auth/refresh`
- `/auth/logout`
- `/license`
- `/devices`
- `/devices/{id}`
- `/devices/{id}/revoke`
- `/sync/pull`
- `/sync/push`

Device credentials are stored in `chrome.storage.local`. This protects them from ordinary websites but not from a user who controls the extension or browser profile. Tokens must therefore be revocable and the backend must validate the license, device, product, subscription, and required entitlement for every premium server operation. Cached entitlements only control local UI and the bounded three-day offline experience.

The licensing implementation is separated into `src/auth`, `src/api`, and `src/storage`. UI gates use the returned entitlement keys—currently `cloud_sync`—rather than trusting a plan name. No Creem API key, private signing key, database secret, or webhook secret may be placed in this repository. `DeviceManager` includes a reserved public-key field so a future version can register a device-generated public key without changing the customer-facing activation flow.

The checkout URL in `src/lib/config.js` currently uses a Creem test payment link. Replace it with the live product payment link before publishing.

### Creem webhook checklist

1. Deploy the Laravel webhook receiver on a public HTTPS URL and confirm it accepts `POST` without web-session authentication or CSRF.
2. In the Creem test dashboard, open **Developers > Webhooks**, register that URL, and copy its webhook secret into the matching Laravel environment (never this extension).
3. Verify the `creem-signature` against the unmodified raw request body using HMAC-SHA256 and the webhook secret.
4. Process each Creem event ID idempotently and return HTTP 200 after accepting it. At minimum, handle `checkout.completed`; also handle refunds, disputes, and subscription events if subscription plans are introduced.
5. Use the Laravel licensing dashboard's **Test without a real purchase** instructions to send a signed test `checkout.completed` event. Confirm it creates a license under the `text-saver` Plus plan.
6. Repeat the webhook registration in Creem live mode, use the separate live webhook secret, and replace the test checkout URL before release.
