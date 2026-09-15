export type PlainTab = {
  id: string;
  name: string;
  kind: 'normal' | 'inbox';
  protected: false;
  text: string;
};

export type EncryptedTab = {
  id: string;
  name: string;
  kind: 'normal';
  protected: true;
  salt: string;
  iv: string;
  ciphertext: string;
  encryptionContextId?: string;
};

export type SaverTab = PlainTab | EncryptedTab;

export type SaverState = {
  version: number;
  tabs: SaverTab[];
  activeTabId: string;
};

export type License = {
  installationId: string;
  deviceName: string;
  product?: string;
  plan?: string;
  billingType?: 'subscription' | 'lifetime';
  licenseStatus?: 'active' | 'expired' | 'revoked';
  expiresAt?: string | null;
  maxDevices?: number;
  activeDevices?: number;
  activation?: {
    deviceId: string;
    deviceName: string;
    activatedAt: string;
    lastSeenAt: string;
  };
  features?: string[];
  planId: 'free' | 'plus';
  status:
    | 'inactive'
    | 'activating'
    | 'active'
    | 'refreshing'
    | 'offline_grace'
    | 'offline_locked'
    | 'expired'
    | 'revoked'
    | 'device_revoked'
    | 'subscription_inactive'
    | 'subscription_expired';
  lastValidatedAt?: number;
  offlineValidUntil?: number;
  validationError?: string;
};

export type LicenseDevice = {
  id: string;
  deviceName: string | null;
  platform: string | null;
  appVersion: string | null;
  activatedAt: string;
  lastSeenAt: string | null;
  isCurrent?: boolean;
};

export type SyncSettings = {
  enabled: boolean;
  selectedTabIds?: string[];
  status?: string;
  error?: string;
  lastSyncedAt?: number;
  revision?: number;
  maxBytes?: number;
};

export type TextMatch = { start: number; end: number };

export type TabContextPosition = {
  tabId: string;
  x: number;
  y: number;
};

export type Plan = {
  id: 'free' | 'plus';
  name: string;
  price: number;
  maxTabs: number;
  maxCharactersPerTab: number;
  maxLinesPerTab: number;
  maxStateBytes: number;
  maxCloudBytes?: number;
  maxSyncedTabs: number;
  maxDevices: number;
  cloudSync: boolean;
};

export type PromptInput = {
  label: string;
  type?: string;
  autocomplete?: string;
  value?: string;
};

export type PromptOption = {
  label: string;
  value: string;
  disabled?: boolean;
  title?: string;
};

export type PromptPreview = {
  name: string;
  protected: boolean;
  size: string;
  status: string;
  conflict: boolean;
};

export type PromptConfig = {
  title: string;
  message?: string;
  confirmLabel?: string;
  input?: PromptInput;
  inputTwo?: PromptInput;
  options?: PromptOption[];
  preview?: PromptPreview[];
  validate?: (first: string, second: string) => string | null | Promise<string | null>;
};
