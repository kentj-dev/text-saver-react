import type { ApiErrorDetails, AuthStatus } from '../auth/types.ts';

const CUSTOMER_MESSAGES: Record<string, string> = {
  BACKEND_NOT_CONFIGURED: 'Licensing is not available right now. Please try again later.',
  NETWORK_ERROR: 'The licensing server could not be reached. Check your connection and try again.',
  LICENSE_DEVICE_LIMIT_EXCEEDED: "You've reached your device limit. Deactivate an old device to activate this one.",
  DEVICE_LIMIT_EXCEEDED: "You've reached your device limit. Deactivate an old device to activate this one.",
  TOKEN_FAMILY_REVOKED: 'Your session has expired. Please activate this device again.',
  REFRESH_TOKEN_REVOKED: 'Your session has expired. Please activate this device again.',
  INVALID_REFRESH_TOKEN: 'Your session has expired. Please activate this device again.',
  DEVICE_REVOKED: 'This device was deactivated. Activate it again to restore access.',
  LICENSE_REVOKED: 'This license has been revoked. Contact support if you think this is a mistake.',
  LICENSE_EXPIRED: 'This license has expired. Renew it to restore Plus features.',
  SUBSCRIPTION_EXPIRED: 'Your subscription has ended. Renew it to restore Plus features.',
  PRODUCT_MISMATCH: 'This license is for a different product.',
  INVALID_LICENSE: 'That license key is not valid. Check the key and try again.',
  ROTATION_REQUIRED: 'Your session could not be renewed safely. Please activate this device again.',
};

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: ApiErrorDetails;

  constructor(
    message: string,
    code = 'REQUEST_FAILED',
    status = 0,
    details?: ApiErrorDetails,
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  get isTemporary(): boolean {
    return this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 500;
  }

  get isAuthenticationFailure(): boolean {
    return this.status === 401 || [
      'TOKEN_FAMILY_REVOKED', 'REFRESH_TOKEN_REVOKED', 'INVALID_REFRESH_TOKEN',
      'DEVICE_REVOKED', 'LICENSE_REVOKED', 'LICENSE_EXPIRED', 'SUBSCRIPTION_EXPIRED',
    ].includes(this.code);
  }
}

export function customerMessage(code: string, fallback?: string): string {
  return CUSTOMER_MESSAGES[code.toUpperCase()] || fallback || 'Something went wrong. Please try again.';
}

export function statusForError(error: ApiError): AuthStatus {
  switch (error.code.toUpperCase()) {
    case 'DEVICE_REVOKED': return 'device_revoked';
    case 'LICENSE_REVOKED': return 'revoked';
    case 'SUBSCRIPTION_EXPIRED': return 'subscription_expired';
    case 'LICENSE_EXPIRED': return 'expired';
    default: return 'inactive';
  }
}

export function errorFromResponse(status: number, payload: unknown): ApiError {
  const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const nestedError = body.error && typeof body.error === 'object'
    ? body.error as Record<string, unknown>
    : undefined;
  const rawCode = body.code || nestedError?.code || body.error_code
    || (typeof body.error === 'string' ? body.error : undefined) || `HTTP_${status}`;
  const code = String(rawCode).toUpperCase();
  const serverMessage = typeof body.message === 'string'
    ? body.message
    : typeof nestedError?.message === 'string' ? nestedError.message : undefined;
  return new ApiError(customerMessage(code, serverMessage), code, status, body);
}
