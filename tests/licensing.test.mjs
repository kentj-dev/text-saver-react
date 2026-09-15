import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiClient } from '../src/api/client.ts';
import { AuthService } from '../src/auth/authService.ts';
import { DeviceManager } from '../src/auth/deviceManager.ts';
import { EntitlementService } from '../src/auth/entitlementService.ts';
import { TokenManager } from '../src/auth/tokenManager.ts';
import { AUTH_SESSION_KEY, LEGACY_LICENSE_KEY, SecureStorage } from '../src/storage/secureStorage.ts';

function memoryArea(initial = {}) {
  const values = structuredClone(initial);
  return {
    values,
    async get(keys) {
      const requested = keys == null ? Object.keys(values) : Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(requested.filter((key) => key in values).map((key) => [key, structuredClone(values[key])]));
    },
    async set(entries) { Object.assign(values, structuredClone(entries)); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key]; },
  };
}

function activeSession(overrides = {}) {
  const now = Date.now();
  return {
    schemaVersion: 1,
    status: 'active',
    deviceUuid: 'device-uuid',
    deviceName: 'Chrome on macOS',
    tokens: {
      accessToken: 'access-old',
      refreshToken: 'refresh-old',
      accessTokenExpiresAt: now + 60_000,
    },
    entitlements: {
      product: 'text-saver',
      plan: 'plus',
      features: ['cloud_sync'],
      billingType: 'lifetime',
    },
    lastValidatedAt: now,
    offlineGraceUntil: now + 86_400_000,
    ...overrides,
  };
}

test('ten simultaneous unauthorized requests cause one rotating refresh', async () => {
  const area = memoryArea({ [AUTH_SESSION_KEY]: activeSession() });
  const storage = new SecureStorage(area);
  const tokens = new TokenManager(storage);
  const client = new ApiClient(tokens, 'https://license.test/api/v1', storage);
  let refreshes = 0;
  let protectedCalls = 0;
  let oldTokenCalls = 0;
  let releaseOldRequests;
  const allOldRequestsStarted = new Promise((resolve) => { releaseOldRequests = resolve; });
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/auth/refresh')) {
      refreshes += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      assert.equal(JSON.parse(options.body).refresh_token, 'refresh-old');
      return Response.json({ access_token: 'access-new', refresh_token: 'refresh-new', expires_in: 900 });
    }
    protectedCalls += 1;
    if (options.headers.Authorization === 'Bearer access-old') {
      oldTokenCalls += 1;
      if (oldTokenCalls === 10) releaseOldRequests();
      await allOldRequestsStarted;
      return Response.json({ error: 'ACCESS_TOKEN_EXPIRED' }, { status: 401 });
    }
    assert.equal(options.headers.Authorization, 'Bearer access-new');
    return Response.json({ ok: true });
  };

  const results = await Promise.all(Array.from({ length: 10 }, () => client.request('/sync/pull', {
    method: 'POST', requiredEntitlement: 'cloud_sync', body: {},
  })));
  assert.equal(refreshes, 1);
  assert.equal(protectedCalls, 20);
  assert.equal(results.every((result) => result.ok), true);
  assert.equal(area.values[AUTH_SESSION_KEY].tokens.refreshToken, 'refresh-new');
  assert.equal(JSON.stringify(area.values).includes('refresh-old'), false);
});

test('a refresh response must rotate the refresh token', async () => {
  const area = memoryArea({ [AUTH_SESSION_KEY]: activeSession({
    tokens: { accessToken: 'expired', refreshToken: 'same-token', accessTokenExpiresAt: 0 },
  }) });
  const manager = new TokenManager(new SecureStorage(area));
  globalThis.fetch = async () => Response.json({
    access_token: 'new-access', refresh_token: 'same-token', expires_in: 900,
  });

  await assert.rejects(() => manager.refresh(), (error) => error.code === 'ROTATION_REQUIRED');
  assert.equal(area.values[AUTH_SESSION_KEY].status, 'inactive');
  assert.equal(area.values[AUTH_SESSION_KEY].tokens, undefined);
});

test('device revocation clears bearer credentials and records a customer-facing state', async () => {
  const area = memoryArea({ [AUTH_SESSION_KEY]: activeSession() });
  const manager = new TokenManager(new SecureStorage(area));
  globalThis.fetch = async () => Response.json({ error: 'DEVICE_REVOKED' }, { status: 401 });

  await assert.rejects(() => manager.refresh(), (error) => {
    assert.equal(error.message, 'This device was deactivated. Activate it again to restore access.');
    return true;
  });
  assert.equal(area.values[AUTH_SESSION_KEY].status, 'device_revoked');
  assert.equal(area.values[AUTH_SESSION_KEY].tokens, undefined);
});

test('temporary refresh failure enters bounded offline grace without unlocking server calls', async () => {
  const area = memoryArea({ [AUTH_SESSION_KEY]: activeSession({
    tokens: { accessToken: 'expired', refreshToken: 'refresh-old', accessTokenExpiresAt: 0 },
  }) });
  const storage = new SecureStorage(area);
  const manager = new TokenManager(storage);
  const client = new ApiClient(manager, 'https://license.test/api/v1', storage);
  globalThis.fetch = async () => { throw new TypeError('offline'); };

  await assert.rejects(() => client.request('/sync/pull', {
    method: 'POST', requiredEntitlement: 'cloud_sync', body: {},
  }), (error) => error.code === 'NETWORK_ERROR');
  assert.equal(area.values[AUTH_SESSION_KEY].status, 'offline_grace');
  assert.ok(area.values[AUTH_SESSION_KEY].offlineGraceUntil > Date.now());
});

test('protected requests send bearer auth and never send a license key', async () => {
  const area = memoryArea({ [AUTH_SESSION_KEY]: activeSession() });
  const storage = new SecureStorage(area);
  const client = new ApiClient(new TokenManager(storage), 'https://license.test/api/v1', storage);
  let observed;
  globalThis.fetch = async (_url, options) => {
    observed = options;
    return Response.json({ revision: 1 });
  };

  await client.request('/sync/push', {
    method: 'POST', requiredEntitlement: 'cloud_sync', body: { data: 'ciphertext' },
  });
  assert.equal(observed.headers.Authorization, 'Bearer access-old');
  assert.equal(JSON.parse(observed.body).license_key, undefined);
});

test('a protected endpoint can revoke the device and clear local credentials', async () => {
  const area = memoryArea({ [AUTH_SESSION_KEY]: activeSession() });
  const storage = new SecureStorage(area);
  const client = new ApiClient(new TokenManager(storage), 'https://license.test/api/v1', storage);
  globalThis.fetch = async () => Response.json({
    error: { code: 'DEVICE_REVOKED', message: 'technical backend detail' },
  }, { status: 403 });

  await assert.rejects(() => client.request('/sync/pull', {
    method: 'POST', requiredEntitlement: 'cloud_sync', body: {},
  }), (error) => error.message === 'This device was deactivated. Activate it again to restore access.');
  assert.equal(area.values[AUTH_SESSION_KEY].status, 'device_revoked');
  assert.equal(area.values[AUTH_SESSION_KEY].tokens, undefined);
});

test('cached entitlements are only a local preflight for premium API routes', async () => {
  const session = activeSession();
  session.entitlements.features = [];
  const area = memoryArea({ [AUTH_SESSION_KEY]: session });
  const storage = new SecureStorage(area);
  const client = new ApiClient(new TokenManager(storage), 'https://license.test/api/v1', storage);
  let called = false;
  globalThis.fetch = async () => { called = true; return Response.json({ ok: true }); };

  await assert.rejects(() => client.request('/sync/pull', {
    method: 'POST', requiredEntitlement: 'cloud_sync', body: {},
  }), (error) => error.code === 'ENTITLEMENT_REQUIRED');
  assert.equal(called, false);
});

test('legacy raw license storage is purged rather than migrated', async () => {
  const area = memoryArea({ [LEGACY_LICENSE_KEY]: { licenseKey: 'raw-customer-key' } });
  const storage = new SecureStorage(area);
  assert.equal(await storage.getSession(), null);
  assert.equal(area.values[LEGACY_LICENSE_KEY], undefined);
  assert.equal(JSON.stringify(area.values).includes('raw-customer-key'), false);
});

test('the installation UUID is generated once and reused', async () => {
  const area = memoryArea();
  globalThis.chrome = {
    storage: { local: area },
    runtime: { getPlatformInfo: async () => ({ os: 'mac' }) },
  };
  const devices = new DeviceManager();
  const first = await devices.getOrCreate();
  const second = await devices.getOrCreate();
  assert.match(first.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(second.id, first.id);
  assert.equal(second.name, 'Chrome on macOS');
});

test('deactivation releases the server device before clearing local credentials', async () => {
  const area = memoryArea({ [AUTH_SESSION_KEY]: activeSession() });
  const storage = new SecureStorage(area);
  let request;
  const api = { request: async (path, options) => { request = { path, options }; return { deactivated: true }; } };
  const auth = new AuthService(storage, {}, new EntitlementService(), api);
  await auth.deactivate();
  assert.equal(request.path, '/licenses/deactivate');
  assert.deepEqual(request.options.body, { product: 'text-saver', device_uuid: 'device-uuid' });
  assert.equal(area.values[AUTH_SESSION_KEY], undefined);
});

test('expired subscription metadata cannot create an active cached entitlement', () => {
  const entitlements = new EntitlementService();
  assert.throws(() => entitlements.fromPayload({
    valid: true,
    license: {
      product: 'text-saver', plan: 'plus', status: 'active', billing_type: 'subscription',
      expires_at: '2020-01-01T00:00:00Z',
    },
  }), (error) => error.code === 'SUBSCRIPTION_EXPIRED');
});
