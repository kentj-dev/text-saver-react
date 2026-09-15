import type { EncryptedTab, License, PlainTab, SaverTab } from '@/types';
import {
  isEncryptedTab as storageIsEncryptedTab,
  isInbox as storageIsInbox,
} from '@/lib/storage.js';

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export function isEncryptedTab(tab: SaverTab | undefined | null): tab is EncryptedTab {
  return storageIsEncryptedTab(tab);
}

export function isInbox(tab: SaverTab | undefined | null): tab is PlainTab & { kind: 'inbox' } {
  return storageIsInbox(tab);
}

export function formatByteSize(bytes: number) {
  if (bytes < 1024) return `${bytes.toLocaleString('en-US')} bytes`;
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toLocaleString('en-US', { maximumFractionDigits: 1 })} MiB`;
  }
  return `${(bytes / 1024).toLocaleString('en-US', { maximumFractionDigits: 1 })} KB`;
}

export function licenseStatusText(license: License | null) {
  if (!license) return 'No license is active on this installation.';
  if (license.status === 'offline_grace') {
    return `Offline grace active until ${new Date(license.offlineValidUntil || 0).toLocaleDateString()}.`;
  }
  if (license.status === 'refreshing') return 'Securely renewing this device session…';
  if (license.status === 'device_revoked') return 'This device was deactivated. Your local notes remain available.';
  if (license.status === 'revoked') return 'This license was revoked. Your local notes remain available.';
  if (license.status === 'subscription_expired' || license.status === 'expired') {
    return 'This plan has expired. Your local notes remain available.';
  }
  if (license.status === 'inactive' && ['TOKEN_FAMILY_REVOKED', 'REFRESH_TOKEN_REVOKED', 'INVALID_REFRESH_TOKEN'].includes(license.validationError || '')) {
    return 'Your session has expired. Activate this device again.';
  }
  if (license.status !== 'active') return 'No license is active on this installation.';
  const checkedAt = license.lastValidatedAt ? new Date(license.lastValidatedAt).toLocaleString() : 'never';
  return `Active on this installation · last checked ${checkedAt}`;
}

export function textStats(text: string) {
  return {
    words: text.trim() ? text.trim().split(/\s+/).length : 0,
    characters: text.length,
    lines: text ? text.split('\n').length : 0,
  };
}

export function findTextMatches(text: string, search: string) {
  if (!search) return [];
  const matches: { start: number; end: number }[] = [];
  const source = text.toLowerCase();
  const query = search.toLowerCase();
  let position = 0;
  while (position <= source.length - query.length) {
    const start = source.indexOf(query, position);
    if (start < 0) break;
    matches.push({ start, end: start + query.length });
    position = start + Math.max(1, query.length);
  }
  return matches;
}
