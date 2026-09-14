# Text Saver React extension

This is the React 19 conversion of Text Saver. It keeps the existing Chrome note-storage keys, state schema, encrypted-tab format, and cloud-sync format so it can replace the current popup without losing user notes.

The paid offering is a single **Plus** lifetime plan at **$2.99**: 20 tabs, 20,000 characters and 10,000 lines per tab, a 5 MiB local-state ceiling, and 5 MiB client-side encrypted sync.

## Stack

- React 19 + Vite
- Tailwind CSS
- Shadcn-style local UI components backed by Radix UI
- Lucide React icons
- `react-sortablejs` for tab ordering
- Self-hosted Montserrat through `@fontsource/montserrat`

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
