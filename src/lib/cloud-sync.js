import {
  STATE_KEY,
  base64ToBytes,
  bytesToBase64,
  createId,
  deriveKeyBytes,
  getOrMigrateState,
  isEncryptedTab,
  isInbox,
  isValidTab,
  isValidState,
  saveState,
} from './storage.js';
import { getPlanLimits } from './plans.js';
import { ensureActiveLicense, licenseApiRequest } from './licensing.js';

export const SYNC_KEY = 'text_saver_cloud_sync';
export const CLOUD_SYNC_ALARM = 'text-saver-cloud-sync';
export const CLOUD_SYNC_SAFETY_DELAY_MS = 60 * 1000;
export const CLOUD_SYNC_RETRY_DELAY_MS = 5 * 60 * 1000;
export const SYNC_DOCUMENT_FORMAT = 'text-saver-cloud-tabs';
export const SYNC_DOCUMENT_VERSION = 2;
const LEGACY_SYNC_AAD = new TextEncoder().encode('text-saver-cloud:v1');
const SYNC_AAD = new TextEncoder().encode('text-saver-cloud:v2');

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function emptySyncDocument() {
  return { format: SYNC_DOCUMENT_FORMAT, version: SYNC_DOCUMENT_VERSION, tabs: [] };
}

function uniqueIds(ids) {
  return [...new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [])];
}

export function isValidSyncDocument(value) {
  return value
    && value.format === SYNC_DOCUMENT_FORMAT
    && value.version === SYNC_DOCUMENT_VERSION
    && Array.isArray(value.tabs)
    && value.tabs.length <= getPlanLimits('plus').maxSyncedTabs
    && value.tabs.every((tab) => isValidTab(tab) && !isInbox(tab))
    && new Set(value.tabs.map((tab) => tab.id)).size === value.tabs.length;
}

export function createSyncDocument(state, selectedTabIds = []) {
  const maxSyncedTabs = getPlanLimits('plus').maxSyncedTabs;
  const ids = uniqueIds(selectedTabIds);
  if (ids.length > maxSyncedTabs) {
    throw new Error(`Plus supports up to ${maxSyncedTabs} synced tabs.`);
  }
  const byId = new Map(state.tabs.filter((tab) => !isInbox(tab)).map((tab) => [tab.id, tab]));
  return {
    format: SYNC_DOCUMENT_FORMAT,
    version: SYNC_DOCUMENT_VERSION,
    tabs: ids.map((id) => byId.get(id)).filter(Boolean).map(clone),
  };
}

function legacyStateToSyncDocument(state) {
  const selectedTabIds = state.tabs
    .filter((tab) => !isInbox(tab))
    .slice(0, getPlanLimits('plus').maxSyncedTabs)
    .map((tab) => tab.id);
  return createSyncDocument(state, selectedTabIds);
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

export function mergeSyncDocuments(baseDocument, localDocument, remoteDocument) {
  const base = baseDocument || emptySyncDocument();
  if (![base, localDocument, remoteDocument].every(isValidSyncDocument)) {
    throw new Error('Cloud data has an unsupported format.');
  }

  const baseTabs = new Map(base.tabs.map((tab) => [tab.id, tab]));
  const localTabs = new Map(localDocument.tabs.map((tab) => [tab.id, tab]));
  const remoteTabs = new Map(remoteDocument.tabs.map((tab) => [tab.id, tab]));
  const ids = new Set([...baseTabs.keys(), ...localTabs.keys(), ...remoteTabs.keys()]);
  const resolved = new Map();
  const conflicts = [];
  ids.forEach((id) => {
    const tab = resolveEntry(baseTabs.get(id), localTabs.get(id), remoteTabs.get(id), conflicts);
    if (tab) resolved.set(id, tab);
  });

  const ordered = [];
  const append = (tab) => {
    if (tab && resolved.has(tab.id) && !ordered.some((item) => item.id === tab.id)) {
      ordered.push(resolved.get(tab.id));
    }
  };
  remoteDocument.tabs.forEach(append);
  localDocument.tabs.forEach(append);
  resolved.forEach(append);

  const maxSyncedTabs = getPlanLimits('plus').maxSyncedTabs;
  if (ordered.length > maxSyncedTabs) {
    throw new Error(`Cloud sync has more than ${maxSyncedTabs} selected tabs. Deselect a tab on another device first.`);
  }

  return {
    document: { format: SYNC_DOCUMENT_FORMAT, version: SYNC_DOCUMENT_VERSION, tabs: ordered },
    conflicts,
  };
}

export function applySyncDocument(localState, document, conflicts = []) {
  if (!isValidState(localState) || !isValidSyncDocument(document)) {
    throw new Error('Cannot apply invalid cloud data.');
  }
  const next = clone(localState);
  const inboxIndex = () => next.tabs.findIndex(isInbox);
  document.tabs.forEach((remoteTab) => {
    const index = next.tabs.findIndex((tab) => tab.id === remoteTab.id);
    if (index >= 0) next.tabs[index] = clone(remoteTab);
    else next.tabs.splice(inboxIndex(), 0, clone(remoteTab));
  });
  conflicts.forEach((tab) => next.tabs.splice(inboxIndex(), 0, clone(tab)));
  if (!next.tabs.some((tab) => tab.id === next.activeTabId)) {
    next.activeTabId = next.tabs.find((tab) => !isInbox(tab))?.id || next.tabs[0].id;
  }
  if (!isValidState(next)) throw new Error('Synced tabs exceed the local safety limit.');
  return next;
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

async function encryptDocument(document, keyBytes) {
  const compressed = await transformStream(new TextEncoder().encode(JSON.stringify(document)), 'compress');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: SYNC_AAD, tagLength: 128 },
    await importSyncKey(keyBytes),
    compressed,
  );
  return { ciphertext, iv };
}

async function decryptPayload(ciphertext, keyBytes, iv, format = '1') {
  const currentFirst = format === String(SYNC_DOCUMENT_VERSION);
  const attempts = currentFirst
    ? [{ legacy: false, aad: SYNC_AAD }, { legacy: true, aad: LEGACY_SYNC_AAD }]
    : [{ legacy: true, aad: LEGACY_SYNC_AAD }, { legacy: false, aad: SYNC_AAD }];
  const key = await importSyncKey(keyBytes);
  for (const attempt of attempts) {
    try {
      const compressed = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv, additionalData: attempt.aad, tagLength: 128 },
        key,
        ciphertext,
      );
      const plaintext = await transformStream(new Uint8Array(compressed), 'decompress');
      const value = JSON.parse(new TextDecoder().decode(plaintext));
      if (!attempt.legacy && isValidSyncDocument(value)) return { document: value, legacyState: null };
      if (attempt.legacy && isValidState(value)) {
        return { document: legacyStateToSyncDocument(value), legacyState: value };
      }
    } catch (_error) {
      // Try the other authenticated format so older backends do not need to echo
      // X-Sync-Format before clients can migrate their encrypted cloud record.
    }
  }
  throw new Error('Cloud data has an unsupported format.');
}

export async function getSyncSettings() {
  const stored = await chrome.storage.local.get(SYNC_KEY);
  return stored[SYNC_KEY] || null;
}

async function saveSyncSettings(settings) {
  await chrome.storage.local.set({ [SYNC_KEY]: settings });
  return settings;
}

function decodeCloudEnvelope(data) {
  let envelope;
  try {
    envelope = JSON.parse(data);
  } catch (_error) {
    throw new Error('Cloud data has an unsupported format.');
  }
  if (
    !envelope
    || typeof envelope.ciphertext !== 'string'
    || typeof envelope.salt !== 'string'
    || typeof envelope.iv !== 'string'
  ) {
    throw new Error('Cloud data has an unsupported format.');
  }
  return {
    ciphertext: base64ToBytes(envelope.ciphertext),
    salt: envelope.salt,
    iv: envelope.iv,
    format: String(envelope.format || '1'),
  };
}

async function fetchCloud(license) {
  const payload = await licenseApiRequest('/sync/pull', license);
  const cloud = {
    revision: Number(payload.revision) || 0,
    data: payload.data,
    maxBytes: Number(payload.max_bytes) || getPlanLimits('plus').maxCloudBytes,
  };
  return typeof payload.data === 'string'
    ? { ...cloud, ...decodeCloudEnvelope(payload.data) }
    : cloud;
}

async function putCloud(license, document, settings, revision = 0, maxBytes) {
  if (!isValidSyncDocument(document)) throw new Error('Refusing to upload invalid cloud data.');
  const keyBytes = base64ToBytes(settings.key);
  const encrypted = await encryptDocument(document, keyBytes);
  const data = JSON.stringify({
    format: SYNC_DOCUMENT_VERSION,
    salt: settings.salt,
    iv: bytesToBase64(encrypted.iv),
    ciphertext: bytesToBase64(new Uint8Array(encrypted.ciphertext)),
  });
  const limit = Number(maxBytes) || getPlanLimits('plus').maxCloudBytes;
  if (new TextEncoder().encode(data).byteLength > limit) {
    throw new Error('Selected tabs exceed the Plus cloud storage limit.');
  }
  const payload = await licenseApiRequest('/sync/push', license, { revision, data });
  return {
    revision: Number(payload.revision),
    maxBytes: Number(payload.max_bytes) || limit,
  };
}

export async function enableCloudSync(password, initialTabIds = []) {
  const license = await ensureActiveLicense();
  const remote = await fetchCloud(license);
  const salt = remote?.salt ? base64ToBytes(remote.salt) : crypto.getRandomValues(new Uint8Array(16));
  const keyBytes = await deriveKeyBytes(password, salt);
  let decodedRemote;
  if (remote?.data) {
    try {
      decodedRemote = await decryptPayload(remote.ciphertext, keyBytes, base64ToBytes(remote.iv), remote.format);
    } catch (_error) {
      throw new Error('The sync password is incorrect. Cloud data was not changed.');
    }
  }
  const localState = await getOrMigrateState();
  let mergedState = localState;
  let document = createSyncDocument(localState, initialTabIds);
  if (decodedRemote?.legacyState) {
    mergedState = mergeStates(null, localState, decodedRemote.legacyState);
    document = legacyStateToSyncDocument(mergedState);
  } else if (decodedRemote?.document) {
    document = decodedRemote.document;
    mergedState = applySyncDocument(localState, document);
  }
  const settings = { enabled: true, key: bytesToBase64(keyBytes), salt: bytesToBase64(salt) };
  const pushed = await putCloud(license, document, settings, remote.revision, remote.maxBytes);
  await saveState(mergedState);
  await saveSyncSettings({
    ...settings,
    selectedTabIds: document.tabs.map((tab) => tab.id),
    baseDocument: clone(document),
    revision: pushed.revision,
    maxBytes: pushed.maxBytes,
    lastSyncedAt: Date.now(),
    status: 'synced',
  });
  return mergedState;
}

export async function syncNow({ retry = true } = {}) {
  const settings = await getSyncSettings();
  if (!settings?.enabled || !settings.key) return null;
  const license = await ensureActiveLicense();
  const localState = await getOrMigrateState();
  const remote = await fetchCloud(license);
  const localDocument = createSyncDocument(localState, settings.selectedTabIds || []);
  let mergedState = localState;
  let mergedDocument = localDocument;
  let conflicts = [];
  if (remote.data) {
    let decoded;
    try {
      decoded = await decryptPayload(
        remote.ciphertext,
        base64ToBytes(settings.key),
        base64ToBytes(remote.iv),
        remote.format,
      );
    } catch (_error) {
      await saveSyncSettings({ ...settings, status: 'password-required', error: 'Cloud data cannot be decrypted.' });
      throw new Error('Cloud data cannot be decrypted with this installation’s sync password.');
    }
    if (decoded.legacyState) {
      mergedState = mergeStates(settings.baseState, localState, decoded.legacyState);
      mergedDocument = legacyStateToSyncDocument(mergedState);
    } else {
      const baseDocument = isValidSyncDocument(settings.baseDocument)
        ? settings.baseDocument
        : emptySyncDocument();
      const result = mergeSyncDocuments(baseDocument, localDocument, decoded.document);
      mergedDocument = result.document;
      conflicts = result.conflicts;
      mergedState = applySyncDocument(localState, mergedDocument, conflicts);
    }
  }
  try {
    const pushed = await putCloud(license, mergedDocument, settings, remote.revision, remote.maxBytes);
    const latestState = await getOrMigrateState();
    if (!same(localState, latestState)) {
      mergedState = mergeStates(localState, latestState, mergedState);
    }
    if (!same(latestState, mergedState)) await saveState(mergedState);
    await saveSyncSettings({
      ...settings,
      selectedTabIds: mergedDocument.tabs.map((tab) => tab.id),
      baseDocument: clone(mergedDocument),
      baseState: undefined,
      revision: pushed.revision,
      maxBytes: pushed.maxBytes,
      lastSyncedAt: Date.now(),
      status: 'synced',
      error: undefined,
    });
    return mergedState;
  } catch (error) {
    if (retry && error.code === 'SYNC_CONFLICT') return syncNow({ retry: false });
    await saveSyncSettings({ ...settings, status: 'error', error: error.message });
    throw error;
  }
}

export async function resetCloudSync(password) {
  const previous = await getSyncSettings();
  const license = await ensureActiveLicense();
  const remote = await fetchCloud(license);
  const localState = await getOrMigrateState();
  const document = createSyncDocument(localState, previous?.selectedTabIds || []);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyBytes = await deriveKeyBytes(password, salt);
  const settings = { enabled: true, key: bytesToBase64(keyBytes), salt: bytesToBase64(salt) };
  const pushed = await putCloud(license, document, settings, remote.revision, remote.maxBytes);
  await saveSyncSettings({
    ...settings,
    selectedTabIds: document.tabs.map((tab) => tab.id),
    baseDocument: clone(document),
    revision: pushed.revision,
    maxBytes: pushed.maxBytes,
    lastSyncedAt: Date.now(),
    status: 'synced',
  });
  return localState;
}

export async function setSyncedTabIds(tabIds) {
  const settings = await getSyncSettings();
  if (!settings?.enabled || !settings.key) throw new Error('Set up cloud sync first.');
  const ids = uniqueIds(tabIds);
  const maxSyncedTabs = getPlanLimits('plus').maxSyncedTabs;
  if (ids.length > maxSyncedTabs) throw new Error(`Plus supports up to ${maxSyncedTabs} synced tabs.`);
  await saveSyncSettings({ ...settings, selectedTabIds: ids, status: 'syncing', error: undefined });
  return syncNow();
}

export async function disableCloudSync() {
  await chrome.storage.local.remove(SYNC_KEY);
}

export async function scheduleCloudSync(delayMs = CLOUD_SYNC_SAFETY_DELAY_MS) {
  const settings = await getSyncSettings();
  if (!settings?.enabled) return;
  await chrome.alarms.create(CLOUD_SYNC_ALARM, { when: Date.now() + Math.max(0, delayMs) });
}

export async function deferCloudSync(message, delayMs = CLOUD_SYNC_RETRY_DELAY_MS) {
  const settings = await getSyncSettings();
  if (!settings?.enabled) return;
  await saveSyncSettings({
    ...settings,
    status: 'pending',
    error: message || 'Changes are saved locally and waiting to sync.',
  });
  await scheduleCloudSync(delayMs);
}

export { STATE_KEY };
