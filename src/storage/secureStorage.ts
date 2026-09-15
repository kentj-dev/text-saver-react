import type { AuthSession } from '../auth/types.ts';

export const AUTH_SESSION_KEY = 'text_saver_device_auth_v1';
export const LEGACY_LICENSE_KEY = 'text_saver_license';

type StorageArea = {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
};

function localStorageArea(): StorageArea {
  if (!globalThis.chrome?.storage?.local) {
    throw new Error('Chrome local storage is unavailable.');
  }
  return chrome.storage.local as StorageArea;
}

function isSession(value: unknown): value is AuthSession {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AuthSession>;
  return candidate.schemaVersion === 1
    && typeof candidate.status === 'string'
    && typeof candidate.deviceUuid === 'string'
    && typeof candidate.deviceName === 'string';
}

/**
 * chrome.storage.local is isolated from websites but is not a secret vault: an
 * extension user can read or modify it. It is appropriate for revocable device
 * credentials only; backend authorization must never trust client state.
 */
export class SecureStorage {
  private readonly storage?: StorageArea;

  constructor(storage?: StorageArea) {
    this.storage = storage;
  }

  private area(): StorageArea {
    return this.storage || localStorageArea();
  }

  async getSession(): Promise<AuthSession | null> {
    const stored = await this.area().get([AUTH_SESSION_KEY, LEGACY_LICENSE_KEY]);
    const current = stored[AUTH_SESSION_KEY];
    if (isSession(current)) return structuredClone(current);

    // Prerelease builds retained the raw license key. Purge it instead of
    // migrating it into the new device-auth record; the user activates once.
    if (stored[LEGACY_LICENSE_KEY] !== undefined) {
      await this.area().remove(LEGACY_LICENSE_KEY);
    }
    return null;
  }

  async setSession(session: AuthSession): Promise<AuthSession> {
    const copy = structuredClone(session);
    await this.area().set({ [AUTH_SESSION_KEY]: copy });
    // Defense in depth: never leave credentials from the legacy architecture.
    await this.area().remove(LEGACY_LICENSE_KEY);
    return copy;
  }

  async clearSession(): Promise<void> {
    await this.area().remove([AUTH_SESSION_KEY, LEGACY_LICENSE_KEY]);
  }
}
