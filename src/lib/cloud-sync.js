import {
  STATE_KEY,
  base64ToBytes,
  bytesToBase64,
  createId,
  deriveKeyBytes,
  getOrMigrateState,
  isEncryptedTab,
  isInbox,
  isValidState,
  saveState,
} from './storage.js';
import { getPlanLimits, serializedStateBytes } from './plans.js';
import { apiRequest, ensureSessionToken } from './licensing.js';

export const SYNC_KEY = 'text_saver_cloud_sync';
export const CLOUD_SYNC_ALARM = 'text-saver-cloud-sync';
const SYNC_AAD = new TextEncoder().encode('text-saver-cloud:v1');

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function conflictCopy(tab) {
  const copy = clone(tab);
  copy.id = createId();
  copy.kind = 'normal';
  copy.name = `${tab.name} (sync conflict)`;
  if (isEncryptedTab(copy)) copy.encryptionContextId = tab.encryptionContextId || tab.id;
  return copy;
}

function resolveEntry(base, local, remote, conflicts) {
  if (same(local, remote)) return clone(local);
  if (same(local, base)) return clone(remote);
  if (same(remote, base)) return clone(local);
  if (local === undefined && remote !== undefined) return clone(remote);
  if (remote === undefined && local !== undefined) return clone(local);
  if (local !== undefined && remote !== undefined) {
    conflicts.push(conflictCopy(remote));
    return clone(local);
  }
  return undefined;
}

export function mergeStates(baseState, localState, remoteState) {
  if (!baseState) baseState = { tabs: [] };
  const baseTabs = new Map(baseState.tabs.filter((tab) => !isInbox(tab)).map((tab) => [tab.id, tab]));
  const localTabs = new Map(localState.tabs.filter((tab) => !isInbox(tab)).map((tab) => [tab.id, tab]));
  const remoteTabs = new Map(remoteState.tabs.filter((tab) => !isInbox(tab)).map((tab) => [tab.id, tab]));
  const ids = new Set([...baseTabs.keys(), ...localTabs.keys(), ...remoteTabs.keys()]);
  const resolved = new Map();
  const conflicts = [];
  ids.forEach((id) => {
    const tab = resolveEntry(baseTabs.get(id), localTabs.get(id), remoteTabs.get(id), conflicts);
    if (tab) resolved.set(id, tab);
  });

  const ordered = [];
  const append = (tab) => {
    if (!tab || !resolved.has(tab.id) || ordered.some((item) => item.id === tab.id)) return;
    ordered.push(resolved.get(tab.id));
  };
  localState.tabs.forEach(append);
  remoteState.tabs.forEach(append);
  resolved.forEach(append);
  ordered.push(...conflicts);

  const baseInbox = baseState.tabs.find(isInbox);
  const localInbox = localState.tabs.find(isInbox);
  const remoteInbox = remoteState.tabs.find(isInbox);
  const inboxConflicts = [];
  let inbox = resolveEntry(baseInbox, localInbox, remoteInbox, inboxConflicts);
  if (!inbox || !isInbox(inbox)) inbox = clone(localInbox || remoteInbox);
  ordered.push(...inboxConflicts, inbox);
  const activeTabId = ordered.some((tab) => tab.id === localState.activeTabId)
    ? localState.activeTabId
    : ordered[0].id;
  return { version: localState.version, tabs: ordered, activeTabId };
}

async function transformStream(bytes, type) {
  const stream = type === 'compress' ? new CompressionStream('gzip') : new DecompressionStream('gzip');
  const writer = stream.writable.getWriter();
  writer.write(bytes);
  writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

async function importSyncKey(keyBytes) {
  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptState(state, keyBytes) {
  const compressed = await transformStream(new TextEncoder().encode(JSON.stringify(state)), 'compress');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: SYNC_AAD, tagLength: 128 },
    await importSyncKey(keyBytes),
    compressed,
  );
  return { ciphertext, iv };
}

async function decryptState(ciphertext, keyBytes, iv) {
  const compressed = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData: SYNC_AAD, tagLength: 128 },
    await importSyncKey(keyBytes),
    ciphertext,
  );
  const plaintext = await transformStream(new Uint8Array(compressed), 'decompress');
  const state = JSON.parse(new TextDecoder().decode(plaintext));
  if (!isValidState(state)) throw new Error('Cloud data has an unsupported format.');
  return state;
}

export async function getSyncSettings() {
  const stored = await chrome.storage.local.get(SYNC_KEY);
  return stored[SYNC_KEY] || null;
}

async function saveSyncSettings(settings) {
  await chrome.storage.local.set({ [SYNC_KEY]: settings });
  return settings;
}

async function fetchCloud(token) {
  try {
    const response = await apiRequest('/v1/sync', { method: 'GET', token, responseType: 'response' });
    return {
      ciphertext: await response.arrayBuffer(),
      etag: response.headers.get('etag'),
      salt: response.headers.get('x-sync-salt'),
      iv: response.headers.get('x-sync-iv'),
    };
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

async function putCloud(token, state, settings, etag) {
  if (serializedStateBytes(state) > getPlanLimits('plus').maxStateBytes) {
    throw new Error('Local data exceeds the Plus cloud state limit.');
  }
  const keyBytes = base64ToBytes(settings.key);
  const encrypted = await encryptState(state, keyBytes);
  const response = await apiRequest('/v1/sync', {
    method: 'PUT',
    token,
    body: encrypted.ciphertext,
    responseType: 'response',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Sync-Format': '1',
      'X-Sync-Salt': settings.salt,
      'X-Sync-IV': bytesToBase64(encrypted.iv),
      ...(etag ? { 'If-Match': etag } : { 'If-None-Match': '*' }),
    },
  });
  return response.headers.get('etag');
}

export async function enableCloudSync(password) {
  const license = await ensureSessionToken();
  const remote = await fetchCloud(license.sessionToken);
  const salt = remote?.salt ? base64ToBytes(remote.salt) : crypto.getRandomValues(new Uint8Array(16));
  const keyBytes = await deriveKeyBytes(password, salt);
  let remoteState;
  if (remote) {
    try {
      remoteState = await decryptState(remote.ciphertext, keyBytes, base64ToBytes(remote.iv));
    } catch (_error) {
      throw new Error('The sync password is incorrect. Cloud data was not changed.');
    }
  }
  const localState = await getOrMigrateState();
  const merged = remoteState ? mergeStates(null, localState, remoteState) : localState;
  const settings = { enabled: true, key: bytesToBase64(keyBytes), salt: bytesToBase64(salt), baseState: null };
  const etag = await putCloud(license.sessionToken, merged, settings, remote?.etag);
  await saveState(merged);
  await saveSyncSettings({ ...settings, baseState: clone(merged), etag, lastSyncedAt: Date.now(), status: 'synced' });
  return merged;
}

export async function syncNow({ retry = true } = {}) {
  const settings = await getSyncSettings();
  if (!settings?.enabled || !settings.key) return null;
  const license = await ensureSessionToken();
  const localState = await getOrMigrateState();
  const remote = await fetchCloud(license.sessionToken);
  let merged = localState;
  if (remote) {
    let remoteState;
    try {
      remoteState = await decryptState(remote.ciphertext, base64ToBytes(settings.key), base64ToBytes(remote.iv));
    } catch (_error) {
      await saveSyncSettings({ ...settings, status: 'password-required', error: 'Cloud data cannot be decrypted.' });
      throw new Error('Cloud data cannot be decrypted with this installation’s sync password.');
    }
    merged = mergeStates(settings.baseState, localState, remoteState);
    if (same(localState, remoteState)) {
      await saveSyncSettings({
        ...settings,
        baseState: clone(localState),
        etag: remote.etag,
        lastSyncedAt: Date.now(),
        status: 'synced',
        error: undefined,
      });
      return localState;
    }
  }
  try {
    const etag = await putCloud(license.sessionToken, merged, settings, remote?.etag);
    if (!same(localState, merged)) await saveState(merged);
    await saveSyncSettings({ ...settings, baseState: clone(merged), etag, lastSyncedAt: Date.now(), status: 'synced', error: undefined });
    return merged;
  } catch (error) {
    if (retry && error.status === 409) return syncNow({ retry: false });
    await saveSyncSettings({ ...settings, status: 'error', error: error.message });
    throw error;
  }
}

export async function resetCloudSync(password) {
  const license = await ensureSessionToken();
  await apiRequest('/v1/sync', { method: 'DELETE', token: license.sessionToken });
  await chrome.storage.local.remove(SYNC_KEY);
  return enableCloudSync(password);
}

export async function disableCloudSync({ deleteRemote = false } = {}) {
  if (deleteRemote) {
    const license = await ensureSessionToken();
    await apiRequest('/v1/sync', { method: 'DELETE', token: license.sessionToken });
  }
  await chrome.storage.local.remove(SYNC_KEY);
}

export async function scheduleCloudSync() {
  const settings = await getSyncSettings();
  if (!settings?.enabled) return;
  await chrome.alarms.create(CLOUD_SYNC_ALARM, { when: Date.now() + 60 * 1000 });
}

export { STATE_KEY };
