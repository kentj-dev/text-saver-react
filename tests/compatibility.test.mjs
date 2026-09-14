import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applySyncDocument,
  createSyncDocument,
  mergeStates,
  mergeSyncDocuments,
} from '../src/lib/cloud-sync.js';
import { activateLicense, effectivePlanId, storeLicense } from '../src/lib/licensing.js';
import { getPlanLimits } from '../src/lib/plans.js';
import { decryptText, encryptText, isValidState } from '../src/lib/storage.js';

const inbox = { id: 'context-menu-inbox', name: 'Context Menu', kind: 'inbox', protected: false, text: '' };
const tab = (id, text) => ({ id, name: id, kind: 'normal', protected: false, text });
const state = (tabs, activeTabId = tabs[0].id) => ({ version: 2, tabs: [...tabs, structuredClone(inbox)], activeTabId });

test('React build keeps the published plan limits and entitlement rules', () => {
  assert.equal(getPlanLimits('free').maxTabs, 10);
  assert.equal(getPlanLimits('plus').maxTabs, 20);
  assert.equal(getPlanLimits('plus').maxCharactersPerTab, 20_000);
  assert.equal(getPlanLimits('plus').maxLinesPerTab, 10_000);
  assert.equal(getPlanLimits('plus').maxStateBytes, 5 * 1024 * 1024);
  assert.equal(getPlanLimits('plus').maxCloudBytes, 5 * 1024 * 1024);
  assert.equal(getPlanLimits('plus').maxSyncedTabs, 5);
  assert.equal(getPlanLimits('plus').maxDevices, 2);
  assert.equal(effectivePlanId({ planId: 'plus', status: 'offline', offlineValidUntil: Date.now() + 1000 }), 'plus');
  assert.equal(effectivePlanId({ planId: 'pro', status: 'active' }), 'plus');
  assert.equal(effectivePlanId({ planId: 'pro', status: 'invalid' }), 'free');
});

test('cloud documents contain only explicitly selected tabs', () => {
  const local = state([tab('local-only', 'private'), tab('shared', 'cloud')]);
  const document = createSyncDocument(local, ['shared']);
  assert.deepEqual(document.tabs.map((item) => item.id), ['shared']);
  assert.equal(document.tabs.some((item) => item.kind === 'inbox'), false);
});

test('cloud documents enforce the five-tab Plus limit', () => {
  const tabs = Array.from({ length: 6 }, (_, index) => tab(`tab-${index}`, `${index}`));
  assert.throws(
    () => createSyncDocument(state(tabs), tabs.map((item) => item.id)),
    /up to 5 synced tabs/,
  );
});

test('a new device receives synced tabs without losing its local tabs', () => {
  const firstDevice = state([tab('shared', 'from device one')]);
  const cloud = createSyncDocument(firstDevice, ['shared']);
  const secondDevice = state([tab('local', 'from device two')], 'local');
  const copied = applySyncDocument(secondDevice, cloud);
  assert.deepEqual(copied.tabs.filter((item) => item.kind === 'normal').map((item) => item.id), ['local', 'shared']);
  assert.equal(copied.tabs.find((item) => item.id === 'shared').text, 'from device one');
});

test('selective sync merges edits while leaving unselected tabs local', () => {
  const base = createSyncDocument(state([tab('shared', 'old')]), ['shared']);
  const localState = state([tab('local-only', 'untouched'), tab('shared', 'local edit')]);
  const local = createSyncDocument(localState, ['shared']);
  const remote = createSyncDocument(state([tab('shared', 'old')]), ['shared']);
  const merged = mergeSyncDocuments(base, local, remote);
  const applied = applySyncDocument(localState, merged.document, merged.conflicts);
  assert.equal(applied.tabs.find((item) => item.id === 'shared').text, 'local edit');
  assert.equal(applied.tabs.find((item) => item.id === 'local-only').text, 'untouched');
});

test('the central licensing credentials are persisted for later validation', async () => {
  let persisted;
  globalThis.chrome = {
    storage: {
      local: {
        set: async (value) => { persisted = value; },
      },
    },
  };
  const saved = await storeLicense({
    licenseKey: 'customer-secret-key',
    installationId: 'installation-id',
    planId: 'plus',
  });
  assert.equal(saved.licenseKey, 'customer-secret-key');
  assert.equal(persisted.text_saver_license.licenseKey, 'customer-secret-key');
  assert.equal(persisted.text_saver_license.installationId, 'installation-id');
});

test('activation uses the Laravel product and snake-case API contract', async () => {
  const values = {};
  let request;
  globalThis.chrome = {
    storage: {
      local: {
        get: async (key) => ({ [key]: values[key] }),
        set: async (value) => { Object.assign(values, value); },
      },
    },
    runtime: {
      getPlatformInfo: async () => ({ os: 'mac' }),
      getManifest: () => ({ version: '6.0.0' }),
    },
  };
  globalThis.fetch = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      activated: true,
      license: {
        product: 'text-saver',
        plan: 'Plus',
        billing_type: 'lifetime',
        status: 'active',
        expires_at: null,
        max_devices: 2,
        active_devices: 1,
      },
      activation: {
        device_id: request.body.device_id,
        device_name: 'My Mac',
        activated_at: '2026-09-14T00:00:00Z',
        last_seen_at: '2026-09-14T00:00:00Z',
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const license = await activateLicense('  license-key  ', 'My Mac');
  assert.equal(request.url, 'https://apps.asterulabs.com/api/v1/licenses/activate');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.body.product, 'text-saver');
  assert.equal(request.body.license_key, 'license-key');
  assert.equal(request.body.device_name, 'My Mac');
  assert.equal(request.body.platform, 'mac');
  assert.equal(request.body.app_version, '6.0.0');
  assert.equal(typeof request.body.device_id, 'string');
  assert.equal(license.status, 'active');
  assert.equal(values.text_saver_license.licenseKey, 'license-key');
});

test('React build accepts the existing version-two storage schema', () => {
  assert.equal(isValidState(state([tab('existing-tab', 'Existing user data')])), true);
});

test('React build preserves three-way sync conflict behavior', () => {
  const base = state([tab('a', 'old')]);
  const merged = mergeStates(base, state([tab('a', 'local')]), state([tab('a', 'remote')]));
  const normalTabs = merged.tabs.filter((item) => item.kind === 'normal');
  assert.equal(normalTabs.length, 2);
  assert.deepEqual(new Set(normalTabs.map((item) => item.text)), new Set(['local', 'remote']));
});

test('React build keeps encrypted-tab authentication context compatibility', async () => {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const encrypted = await encryptText('secret', 'original-id', key);
  const duplicate = {
    id: 'conflict-id', name: 'Secret (sync conflict)', kind: 'normal', protected: true,
    encryptionContextId: 'original-id', ...encrypted,
  };
  assert.equal(await decryptText(duplicate, key), 'secret');
});
