import { BILLING_CONFIG } from "../lib/config.js";

export const INSTALLATION_KEY = "text_saver_installation";

export type Installation = {
  id: string;
  name: string;
  platform: string;
  createdAt: string;
  publicKey?: string;
};

function friendlyPlatform(os?: string): string {
  return (
    (
      {
        mac: "macOS",
        win: "Windows",
        linux: "Linux",
        cros: "ChromeOS",
      } as Record<string, string>
    )[os || ""] || "this device"
  );
}

function uuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class DeviceManager {
  async getOrCreate(): Promise<Installation> {
    const stored = await chrome.storage.local.get(INSTALLATION_KEY);
    const existing = stored[INSTALLATION_KEY] as Installation | undefined;
    if (existing?.id && existing?.name) {
      if (existing.platform) return structuredClone(existing);
      const platform = await chrome.runtime
        .getPlatformInfo()
        .catch(() => ({ os: "unknown" as const }));
      const updated = {
        ...existing,
        platform: String(platform.os || "unknown"),
      };
      await chrome.storage.local.set({ [INSTALLATION_KEY]: updated });
      return structuredClone(updated);
    }

    const platform = await chrome.runtime
      .getPlatformInfo()
      .catch(() => ({ os: "unknown" as const }));
    const installation: Installation = {
      id: uuid(),
      name: `Chrome on ${friendlyPlatform(platform.os)}`,
      platform: String(platform.os || "unknown"),
      createdAt: new Date().toISOString(),
    };
    await chrome.storage.local.set({ [INSTALLATION_KEY]: installation });
    return structuredClone(installation);
  }

  async rename(name: string): Promise<Installation> {
    const installation = await this.getOrCreate();
    const updated = { ...installation, name: name.trim() || installation.name };
    await chrome.storage.local.set({ [INSTALLATION_KEY]: updated });
    return updated;
  }

  activationPayload(installation: Installation) {
    return {
      product: BILLING_CONFIG.productSlug,
      device_id: installation.id,
      device_name: installation.name,
      platform: installation.platform,
      app_version: chrome.runtime.getManifest().version,
      // Reserved for a future non-exportable device key registration flow.
      ...(installation.publicKey ? { public_key: installation.publicKey } : {}),
    };
  }
}

export const deviceManager = new DeviceManager();
