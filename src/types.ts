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
  licenseId?: string;
  licenseFingerprint?: string;
  installationToken: string;
  installationId: string;
  deviceName: string;
  instanceId: string;
  planId: 'plus';
  status: 'active' | 'offline' | 'invalid';
  lastValidatedAt?: number;
  offlineValidUntil?: number;
  sessionToken?: string;
  sessionExpiresAt?: number;
};

export type Device = {
  installationId: string;
  deviceName: string;
  activatedAt: number;
};

export type SyncSettings = {
  enabled: boolean;
  status?: string;
  error?: string;
  lastSyncedAt?: number;
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
