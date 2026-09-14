import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeStates } from '../src/lib/cloud-sync.js';
import { effectivePlanId, storeLicense } from '../src/lib/licensing.js';
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
  assert.equal(effectivePlanId({ planId: 'plus', status: 'offline', offlineValidUntil: Date.now() + 1000 }), 'plus');
  assert.equal(effectivePlanId({ planId: 'pro', status: 'active' }), 'plus');
  assert.equal(effectivePlanId({ planId: 'pro', status: 'invalid' }), 'free');
});

test('the reusable license key is never persisted', async () => {
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
    installationToken: 'scoped-installation-token',
    planId: 'plus',
  });
  assert.equal('licenseKey' in saved, false);
  assert.equal('licenseKey' in persisted.text_saver_license, false);
  assert.equal(persisted.text_saver_license.installationToken, 'scoped-installation-token');
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
