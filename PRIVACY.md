# Text Saver Privacy Policy

**Effective date:** September 15, 2026

This Privacy Policy explains how Text Saver, operated by the publisher identified on its Chrome Web Store listing ("Text Saver," "we," "us," or "our"), handles information when you use the Text Saver browser extension.

## Summary

Text Saver saves your notes in your browser by default. We do not sell personal information, use your notes for advertising, or use analytics or advertising trackers in the extension.

If you activate a Plus license, the extension contacts the Text Saver licensing service. If you separately enable cloud sync, only the tabs you select are encrypted on your device before they are uploaded. Your Context Menu inbox is never included in cloud sync.

## Information stored on your device

Text Saver uses Chrome extension storage to keep the information needed to provide its features, including:

- notes, tab names, tab order, preferences, and other extension state;
- text you explicitly send to Text Saver using its context-menu action;
- password-protection metadata for protected tabs;
- an installation identifier and user-editable device name;
- license status, entitlements, validation timestamps, and revocable device-session credentials when Plus is activated; and
- cloud-sync settings, including the selected tab identifiers and locally derived encryption-key material, when cloud sync is enabled.

Ordinary local notes are not encrypted by Text Saver. A password-protected tab is encrypted locally using AES-GCM with a key derived from the password. Text Saver does not retain that password. A temporarily cached unlock key is removed after a short inactivity period or when the tab is locked.

Anyone with sufficient access to your browser profile or device may be able to inspect extension storage. You are responsible for securing your device and Chrome profile.

Backups and text files are created only when you choose to export or download them. Those files are saved to a location controlled by you and are not uploaded by the export feature.

## Information sent to Text Saver services

The extension communicates with `https://apps.hamiken.com` over HTTPS for Plus licensing and optional cloud sync. Depending on the feature you use, the service receives:

- the license key you submit during activation;
- a randomly generated installation identifier;
- the device name, platform, and extension version;
- license, entitlement, device, subscription, and validation status information;
- revocable access and refresh tokens used to authenticate that installation; and
- an encrypted cloud-sync payload with operational metadata such as its revision, size, checksum, and update time.

The activation service receives the license key only when you activate an installation. The extension does not save the raw license key after activation. As part of an ordinary network request, the service also receives your IP address and uses it for security, abuse prevention, and rate limiting.

We use this information only to activate and validate Plus access, enforce device and storage limits, manage devices, prevent abuse, troubleshoot the service, and provide the features you request.

## Optional encrypted cloud sync

Cloud sync is off until you enable it. Plus users can choose up to five ordinary tabs to sync. Tabs you do not select and the Context Menu inbox remain local to that browser profile.

Before upload, the selected tab data is compressed and encrypted on your device using AES-256-GCM with a key derived from the separate sync password you provide. The sync password is not sent to or retained by Text Saver. The server stores a single opaque encrypted payload of up to 5 MiB per license and cannot read its contents without the key.

The derived sync key and salt are stored in Chrome extension storage so the extension can synchronize without asking for the password every time. A person with sufficient access to your browser profile may be able to obtain that material and decrypt the cloud copy. If you lose both the sync password and every browser profile holding the derived key, Text Saver cannot recover the encrypted content.

Turning off cloud sync removes the local sync configuration but does not delete the encrypted server copy. "Reset encrypted cloud copy" replaces the existing cloud payload with a newly encrypted copy of the currently selected local tabs.

## Purchases and payment provider

Plus purchases are processed by Creem. When you follow the purchase link, Creem handles the checkout under its own privacy terms. Text Saver does not receive or store your full payment-card details. The licensing service receives the purchase and license status needed to issue, renew, expire, or revoke Plus access.

## Sharing and disclosure

We do not sell or rent your personal information. We disclose information only:

- to Creem to process purchases and administer the corresponding license;
- to service providers that host, secure, or operate the licensing and encrypted-sync infrastructure, under instructions to provide those services;
- when required by law or a valid legal process;
- when reasonably necessary to protect users, prevent fraud or abuse, or secure Text Saver; or
- as part of a merger, acquisition, financing, or sale of the service, subject to appropriate confidentiality and notice where required.

We do not disclose note contents to advertisers or data brokers, and we do not use note contents for personalized advertising.

## Retention and deletion

Local extension data remains in your Chrome profile until you delete it in Text Saver, clear the extension's data, or uninstall the extension. Signing out of Plus or deactivating an installation does not delete local notes.

An encrypted cloud copy may remain on the server after you turn off sync, sign out, uninstall the extension, or lose Plus access. License, device, transaction-status, security, and service records are retained for as long as reasonably necessary to operate the service, protect it from fraud and abuse, meet accounting or legal obligations, and resolve disputes.

To request deletion of an encrypted cloud copy or other server-side information associated with your license, use the support contact published on Text Saver's Chrome Web Store listing. We may need information sufficient to verify that you control the relevant license. Some records may be retained where required by law or for legitimate security, fraud-prevention, accounting, or dispute-resolution purposes.

## Security

We use technical and organizational safeguards intended to protect information, including HTTPS for network traffic, revocable installation credentials, device limits, and client-side encryption for optional cloud-sync content. No storage or transmission method is completely secure, so we cannot guarantee absolute security.

## Children's privacy

Text Saver is not directed to children under 13, and we do not knowingly collect personal information from children under 13. If you believe a child has provided personal information through the service, contact us through the Chrome Web Store support contact.

## Your choices and rights

You can use Text Saver without activating Plus or enabling cloud sync. You can choose which eligible tabs to sync, turn sync off, delete local notes, export a backup, and sign out or manage activated devices. Depending on where you live, you may also have legal rights to access, correct, delete, or restrict the use of personal information. Submit such requests through the support contact on the Chrome Web Store listing.

## Changes to this policy

We may update this Privacy Policy as Text Saver or applicable requirements change. We will update the effective date above and provide any additional notice required by law.

## Contact

For privacy questions or requests, use the publisher support contact listed on Text Saver's Chrome Web Store page. Include enough information to identify the relevant installation or license, but do not send your sync password, access token, refresh token, or full note contents.
