import { apiClient } from '../api/client.ts';
import { ApiError } from '../api/errors.ts';
import { licenseView, LICENSING_MESSAGE } from '../lib/licensing.js';
import { authService } from './authService.ts';

type CommandPayload = Record<string, unknown>;

function serializedError(error: unknown) {
  if (error instanceof ApiError) {
    return { message: error.message, code: error.code, status: error.status, details: error.details };
  }
  return {
    message: error instanceof Error ? error.message : 'Licensing request failed.',
    code: 'REQUEST_FAILED',
    status: 0,
  };
}

export async function runLicensingCommand(action: string, payload: CommandPayload = {}) {
  switch (action) {
    case 'getLicense':
      return licenseView(await authService.session());
    case 'clearLocal':
      await authService.logoutLocal();
      return null;
    case 'activate':
      return licenseView(await authService.activate(String(payload.licenseKey || ''), String(payload.deviceName || '')));
    case 'validate':
      return licenseView(await authService.validate(Boolean(payload.force)));
    case 'logout':
      await authService.deactivate();
      return null;
    case 'listDevices': {
      const result = await apiClient.request<{ max_devices: number; devices: Array<Record<string, unknown>> }>('/devices', { method: 'GET' });
      return {
        maxDevices: Number(result.max_devices) || 0,
        devices: Array.isArray(result.devices) ? result.devices.map((device) => ({
          id: String(device.id),
          deviceName: device.device_name == null ? null : String(device.device_name),
          platform: device.platform == null ? null : String(device.platform),
          appVersion: device.app_version == null ? null : String(device.app_version),
          activatedAt: String(device.activated_at || ''),
          lastSeenAt: device.last_seen_at == null ? null : String(device.last_seen_at),
          isCurrent: Boolean(device.is_current),
        })) : [],
      };
    }
    case 'deactivateDevice':
      await apiClient.request(`/devices/${encodeURIComponent(String(payload.id || ''))}`, { method: 'DELETE' });
      return null;
    case 'revokeDevice':
      await apiClient.request(`/devices/${encodeURIComponent(String(payload.id || ''))}/revoke`, { method: 'POST' });
      return null;
    case 'request': {
      const path = String(payload.path || '');
      if (!['/sync/pull', '/sync/push'].includes(path)) {
        throw new ApiError('Unsupported licensing request.', 'INVALID_CLIENT_REQUEST', 400);
      }
      return apiClient.request(path, {
        method: 'POST',
        ...(payload.body === undefined ? {} : { body: payload.body }),
        requiredEntitlement: 'cloud_sync',
      });
    }
    default:
      throw new ApiError('Unsupported licensing action.', 'INVALID_CLIENT_REQUEST', 400);
  }
}

export async function handleLicensingMessage(message: unknown) {
  const request = message as { type?: string; action?: string; payload?: CommandPayload };
  if (request?.type !== LICENSING_MESSAGE) return undefined;
  try {
    return { ok: true, result: await runLicensingCommand(String(request.action || ''), request.payload) };
  } catch (error) {
    return { ok: false, error: serializedError(error) };
  }
}
