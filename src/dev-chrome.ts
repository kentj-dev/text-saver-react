// Minimal in-memory Chrome API for `npm run dev`. This module is removed from
// production builds and lets the popup be reviewed in a normal browser tab.
type Listener = (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => void;

const listeners = new Set<Listener>();

function createStorageArea(areaName: string, initial: Record<string, unknown> = {}) {
  const values = new Map<string, unknown>(Object.entries(initial));
  return {
    async get(keys?: string | string[] | Record<string, unknown> | null) {
      const result: Record<string, unknown> = {};
      const requested = keys == null ? [...values.keys()] : typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      requested.forEach((key) => {
        if (values.has(key)) result[key] = values.get(key);
        else if (keys && !Array.isArray(keys) && typeof keys === 'object') result[key] = keys[key];
      });
      return result;
    },
    async set(entries: Record<string, unknown>) {
      const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
      Object.entries(entries).forEach(([key, value]) => {
        changes[key] = { oldValue: values.get(key), newValue: value };
        values.set(key, structuredClone(value));
      });
      listeners.forEach((listener) => listener(changes, areaName));
    },
    async remove(keys: string | string[]) {
      const requested = Array.isArray(keys) ? keys : [keys];
      const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
      requested.forEach((key) => {
        changes[key] = { oldValue: values.get(key) };
        values.delete(key);
      });
      listeners.forEach((listener) => listener(changes, areaName));
    },
  };
}

(globalThis as any).chrome = {
  storage: {
    local: createStorageArea('local', new URL(location.href).searchParams.has('skip-guide') ? { text_saver_guide_seen_v1: true } : {}),
    session: createStorageArea('session'),
    onChanged: {
      addListener: (listener: Listener) => listeners.add(listener),
      removeListener: (listener: Listener) => listeners.delete(listener),
    },
  },
  alarms: {
    create: async () => undefined,
    clear: async () => true,
  },
  runtime: {
    getPlatformInfo: async () => ({ os: 'mac' }),
  },
};

export {};
