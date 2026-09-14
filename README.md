# Text Saver React extension

This is the React 19 conversion of Text Saver. It keeps the existing Chrome note-storage keys, state schema, and encrypted-tab format so it can replace the current popup without losing user notes. It can also read the previous whole-state cloud format and migrate it to selective tab sync.

The paid offering is a single **Plus** lifetime plan at **$2.99**: 20 tabs, 20,000 characters and 10,000 lines per tab, a 5 MiB local-state ceiling, and client-side encrypted sync for up to five selected tabs across two activated devices.

Cloud selection belongs to the license, not an individual installation. After activating the same license on another device, the user enters the same sync password and the selected tabs are copied into that device without replacing its local-only tabs. The special Context Menu inbox always remains local.

The `/v1/sync` backend record must therefore be keyed by the license entitlement, not by `installationId`. Each installation token authorizes access to that shared encrypted record. Version-two uploads include `X-Sync-Format: 2` and `X-Sync-Tab-Count`; the backend should reject counts above five and enforce the encrypted payload byte limit.

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

Laravel integration is intentionally disabled for now. Add its HTTPS API URL and the new Plus checkout URL in `src/lib/config.js`, then add the Laravel origin to `public/manifest.json` under `host_permissions`.

The activation response must contain a random, revocable `installationToken`. Text Saver submits the customer license key only to `/v1/licenses/activate` and never persists it. Validation, device management, deactivation, and entitlement-token refresh use the installation token as a Bearer credential. A token stored on the client remains inspectable by the device owner, so the Laravel backend must scope it to one installation and support rotation and revocation.
