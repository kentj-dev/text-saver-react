export type AuthStatus =
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

export type Entitlements = {
  product: string;
  plan: string;
  features: string[];
  licenseStatus?: string;
  billingType?: 'subscription' | 'lifetime';
  expiresAt?: string | null;
  maxDevices?: number;
  activeDevices?: number;
};

export type DeviceRegistration = {
  deviceId?: string;
  deviceName: string;
  platform?: string;
  appVersion?: string;
  activatedAt?: string;
  lastSeenAt?: string;
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

export type TokenSet = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number;
  refreshTokenExpiresAt?: number;
};

export type AuthSession = {
  schemaVersion: 1;
  status: AuthStatus;
  deviceUuid: string;
  deviceName: string;
  tokens?: TokenSet;
  entitlements?: Entitlements;
  registration?: DeviceRegistration;
  lastValidatedAt?: number;
  offlineGraceUntil?: number;
  errorCode?: string;
};

export type TokenPayload = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  access_token_expires_at?: string | number;
  refresh_token_expires_at?: string | number;
};

export type ApiErrorDetails = Record<string, unknown>;
