# Text Saver privacy disclosure draft

Text Saver stores notes locally in the browser. Notes are sent to Text Saver servers only when a Plus user explicitly enables encrypted cloud sync.

Plus cloud sync is optional. Before upload, the extension compresses and encrypts the complete note state using AES-256-GCM and a key derived from the user’s separate sync password. Text Saver does not receive or retain that password and cannot recover encrypted notes if it is lost.

To provide licensing and sync, Text Saver processes a license identifier, pseudonymous installation identifier, user-selected device label, activation status, and validation timestamps. A raw Creem license key is submitted only during activation and is not retained in browser storage. The backend returns a revocable credential scoped to that installation. The server stores at most 5 MiB of encrypted sync data per Plus license.

The installation-scoped credential and derived cloud-encryption key are stored locally in the browser profile so the extension can validate access and synchronize without requesting credentials every time. Like all client-side credentials, they can be inspected by someone with access to the browser profile. The original license key and sync password are not retained.

Users can delete their encrypted cloud copy from the extension. When a purchase is fully refunded or disputed, cloud access is revoked and the encrypted copy is scheduled for deletion after 30 days. Deactivating an installation does not delete its local notes.

Replace this draft with your business identity, contact address, applicable legal basis, processor list, jurisdiction, effective date, and final terms before publishing.
