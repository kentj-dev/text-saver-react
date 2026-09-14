import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ReactSortable } from 'react-sortablejs';
import {
  ArrowDown, ArrowUp, Check, Clipboard, Cloud, Copy, Download, Ellipsis,
  FileDown, FileUp, FolderInput, HelpCircle, Inbox, KeyRound, Lock, Moon,
  Pencil, Plus, Search, Shield, Sun, Trash2, Unlock, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { PlanPanel } from '@/components/PlanPanel';
import { PromptDialog } from '@/components/PromptDialog';
import { cn } from '@/lib/utils';
import { getPlanLimits, serializedStateBytes } from '@/lib/plans.js';
import {
  LicenseApiError, activateLicense, currentPlan, deactivateInstallation, effectivePlanId,
  getInstallation, getStoredLicense, listLicenseDevices, validateLicense,
} from '@/lib/licensing.js';
import {
  disableCloudSync, enableCloudSync, getSyncSettings, resetCloudSync,
  syncNow as synchronizeNow,
} from '@/lib/cloud-sync.js';
import {
  UNLOCK_MS, UNLOCK_PREFIX, base64ToBytes, cacheUnlockKey, clearUnlockKey,
  createPlainTab, decryptText, deriveKeyBytes, encryptText, getCachedUnlockKey,
  getOrMigrateState, isEncryptedTab as storageIsEncryptedTab, isInbox as storageIsInbox, isValidState, saveState,
} from '@/lib/storage.js';
import type { Device, EncryptedTab, License, PlainTab, PromptConfig, SaverState, SaverTab, SyncSettings } from '@/types';

const AUTOSAVE_DELAY = 300;
const MIN_PASSWORD_LENGTH = 8;
const THEME_KEY = 'text_saver_theme';
const GUIDE_SEEN_KEY = 'text_saver_guide_seen_v1';
const BACKUP_FORMAT = 'text-saver-backup';
const BACKUP_VERSION = 1;
const MAX_BACKUP_BYTES = 16 * 1024 * 1024;

const GUIDE_STEPS = [
  ['Welcome to Text Saver', 'Save, organize, protect, and move snippets without leaving your browser.'],
  ['Organize with tabs', 'Click to switch, drag to reorder, or right-click any tab for its actions.'],
  ['Write and autosave', 'Your text is saved locally as you type. The status in the header confirms each save.'],
  ['Protect sensitive tabs', 'Encrypt any regular tab with a password. Unlocked tabs lock automatically after two minutes.'],
  ['Find and copy', 'Search the active tab, copy a single line, copy everything, or download a text file.'],
  ['Back up your work', 'Export a portable JSON backup or merge an existing backup without overwriting conflicts.'],
  ['Plus and cloud', 'Activate Plus on two installations to unlock higher limits and client-side encrypted cloud sync.'],
];

function clone<T>(value: T): T { return structuredClone(value); }
function isEncryptedTab(tab: SaverTab | undefined | null): tab is EncryptedTab { return storageIsEncryptedTab(tab); }
function isInbox(tab: SaverTab | undefined | null): tab is PlainTab & { kind: 'inbox' } { return storageIsInbox(tab); }

function formatByteSize(bytes: number) {
  if (bytes < 1024) return `${bytes.toLocaleString('en-US')} bytes`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toLocaleString('en-US', { maximumFractionDigits: 1 })} MiB`;
  return `${(bytes / 1024).toLocaleString('en-US', { maximumFractionDigits: 1 })} KB`;
}

function licenseStatusText(license: License | null) {
  if (!license) return 'No license is active on this installation.';
  if (license.status === 'offline') return `Offline grace active until ${new Date(license.offlineValidUntil || 0).toLocaleDateString()}.`;
  if (license.status !== 'active') return 'This license is no longer valid. Your notes remain available.';
  return `Active on this installation · last checked ${license.lastValidatedAt ? new Date(license.lastValidatedAt).toLocaleString() : 'never'}`;
}

function statsFor(text: string) {
  return {
    words: text.trim() ? text.trim().split(/\s+/).length : 0,
    characters: text.length,
    lines: text ? text.split('\n').length : 0,
  };
}

export default function App() {
  const [state, setState] = useState<SaverState | null>(null);
  const stateRef = useRef<SaverState | null>(null);
  const [editorText, setEditorText] = useState('');
  const editorTextRef = useRef('');
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const [lineHeights, setLineHeights] = useState<number[]>([20]);
  const [measureVersion, setMeasureVersion] = useState(0);
  const [locked, setLocked] = useState(false);
  const unlockedKeys = useRef(new Map<string, Uint8Array>());
  const unlockedText = useRef(new Map<string, string>());
  const lockTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const lockTabRef = useRef<(tabId: string, clearSession?: boolean) => Promise<void>>(async () => undefined);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'error'>('idle');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saveQueue = useRef(Promise.resolve());
  const editPending = useRef(false);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findIndex, setFindIndex] = useState(-1);
  const [planOpen, setPlanOpen] = useState(false);
  const [license, setLicense] = useState<License | null>(null);
  const [syncSettings, setSyncSettings] = useState<SyncSettings | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceError, setDeviceError] = useState('');
  const [licenseError, setLicenseError] = useState('');
  const [licenseInput, setLicenseInput] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [planBusy, setPlanBusy] = useState(false);
  const [promptConfig, setPromptConfig] = useState<PromptConfig | null>(null);
  const promptResolver = useRef<((value: boolean | string | string[] | null) => void) | undefined>(undefined);
  const [contextMenu, setContextMenu] = useState<{ tabId: string; x: number; y: number } | null>(null);
  const [guideIndex, setGuideIndex] = useState<number | null>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);

  const showToast = useCallback((message: string) => {
    clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(''), 1900);
  }, []);

  const ask = useCallback((config: PromptConfig) => new Promise<boolean | string | string[] | null>((resolve) => {
    promptResolver.current?.(null);
    promptResolver.current = resolve;
    setPromptConfig(config);
  }), []);

  const resolvePrompt = useCallback((value: boolean | string | string[] | null) => {
    const resolve = promptResolver.current;
    promptResolver.current = undefined;
    setPromptConfig(null);
    resolve?.(value);
  }, []);

  const activeTab = useMemo(() => state?.tabs.find((tab) => tab.id === state.activeTabId) || state?.tabs[0], [state]);
  const planId = effectivePlanId(license) as 'free' | 'plus';
  const activePlan = getPlanLimits(planId);
  const normalTabCount = state?.tabs.filter((tab) => !isInbox(tab)).length || 0;
  const stats = useMemo(() => statsFor(editorText), [editorText]);
  const matches = useMemo(() => {
    if (!findQuery) return [] as { start: number; end: number }[];
    const found = [];
    const source = editorText.toLowerCase();
    const query = findQuery.toLowerCase();
    let position = 0;
    while (position <= source.length - query.length) {
      const start = source.indexOf(query, position);
      if (start < 0) break;
      found.push({ start, end: start + query.length });
      position = start + Math.max(1, query.length);
    }
    return found;
  }, [editorText, findQuery]);

  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { editorTextRef.current = editorText; }, [editorText]);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const observer = new ResizeObserver(() => setMeasureVersion((value) => value + 1));
    observer.observe(editor);
    void document.fonts?.ready.then(() => setMeasureVersion((value) => value + 1));
    return () => observer.disconnect();
  }, [state?.activeTabId]);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor || locked) return;
    const lines = editorText.split('\n');
    const styles = getComputedStyle(editor);
    const lineHeight = Number.parseFloat(styles.lineHeight) || 18;
    const mirror = document.createElement('div');
    Object.assign(mirror.style, {
      position: 'fixed', left: '-10000px', top: '0', visibility: 'hidden', pointerEvents: 'none',
      width: `${editor.clientWidth}px`, padding: styles.padding, border: '0', boxSizing: 'border-box',
      fontFamily: styles.fontFamily, fontSize: styles.fontSize, fontWeight: styles.fontWeight,
      fontStyle: styles.fontStyle, letterSpacing: styles.letterSpacing, lineHeight: styles.lineHeight,
      whiteSpace: 'pre-wrap', overflowWrap: 'break-word', wordBreak: styles.wordBreak,
    });
    const spans = lines.map((line) => {
      const span = document.createElement('span');
      span.style.display = 'block';
      span.style.minHeight = `${lineHeight}px`;
      span.textContent = line || '\u200b';
      mirror.append(span);
      return span;
    });
    document.body.append(mirror);
    setLineHeights(spans.map((span) => Math.max(lineHeight, span.getBoundingClientRect().height)));
    mirror.remove();
  }, [editorText, locked, measureVersion]);

  const persist = useCallback((snapshot: SaverState, indicate = false) => {
    clearTimeout(saveTimer.current);
    if (indicate) setSaveStatus('saving');
    saveQueue.current = saveQueue.current.catch(() => undefined).then(() => saveState(clone(snapshot)));
    return saveQueue.current.then(() => indicate && setSaveStatus('idle')).catch((error) => {
      setSaveStatus('error');
      throw error;
    });
  }, []);

  const touchUnlock = useCallback(async (tab: SaverTab) => {
    if (!isEncryptedTab(tab)) return;
    const key = unlockedKeys.current.get(tab.id);
    if (!key) return;
    clearTimeout(lockTimers.current.get(tab.id));
    const expiresAt = await cacheUnlockKey(tab.id, key, Date.now() + UNLOCK_MS);
    lockTimers.current.set(tab.id, setTimeout(() => void lockTabRef.current(tab.id), Math.max(0, expiresAt - Date.now())));
  }, []);

  const flushEditor = useCallback(async () => {
    const current = stateRef.current;
    if (!current) return;
    const next = clone(current);
    const tab = next.tabs.find((item) => item.id === next.activeTabId);
    if (!tab || (isEncryptedTab(tab) && !unlockedKeys.current.has(tab.id))) return persist(next);
    if (isEncryptedTab(tab)) {
      const key = unlockedKeys.current.get(tab.id)!;
      const payload = await encryptText(editorTextRef.current, tab.id, key, base64ToBytes(tab.salt), tab.encryptionContextId || tab.id);
      Object.assign(tab, payload);
      unlockedText.current.set(tab.id, editorTextRef.current);
    } else {
      tab.text = editorTextRef.current;
    }
    stateRef.current = next;
    setState(next);
    const pending = editPending.current;
    editPending.current = false;
    await persist(next, pending);
  }, [persist]);

  const displayState = useCallback(async (nextState: SaverState) => {
    const tab = nextState.tabs.find((item) => item.id === nextState.activeTabId) || nextState.tabs[0];
    let available = !isEncryptedTab(tab) || unlockedKeys.current.has(tab.id);
    if (isEncryptedTab(tab) && !available) {
      const cached = await getCachedUnlockKey(tab.id);
      if (cached) {
        try {
          const text = await decryptText(tab, cached.keyBytes);
          unlockedKeys.current.set(tab.id, cached.keyBytes);
          unlockedText.current.set(tab.id, text);
          lockTimers.current.set(tab.id, setTimeout(() => void lockTabRef.current(tab.id), Math.max(0, cached.expiresAt - Date.now())));
          available = true;
        } catch {
          await clearUnlockKey(tab.id);
        }
      }
    }
    setLocked(isEncryptedTab(tab) && !available);
    const text = isEncryptedTab(tab) ? (available ? unlockedText.current.get(tab.id) || '' : '') : tab.text;
    editorTextRef.current = text;
    setEditorText(text);
    setFindIndex(-1);
    if (isEncryptedTab(tab) && available) await touchUnlock(tab);
  }, [touchUnlock]);

  const lockTab = useCallback(async (tabId: string, clearSession = true) => {
    const current = stateRef.current;
    const tab = current?.tabs.find((item) => item.id === tabId);
    if (!current || !tab || !isEncryptedTab(tab) || !unlockedKeys.current.has(tabId)) return;
    if (tab.id === current.activeTabId) await flushEditor();
    clearTimeout(lockTimers.current.get(tabId));
    lockTimers.current.delete(tabId);
    unlockedKeys.current.delete(tabId);
    unlockedText.current.delete(tabId);
    if (clearSession) await clearUnlockKey(tabId);
    if (tab.id === current.activeTabId) {
      setLocked(true);
      setEditorText('');
      editorTextRef.current = '';
    }
  }, [flushEditor]);
  useEffect(() => { lockTabRef.current = lockTab; }, [lockTab]);

  const refreshEntitlement = useCallback(async (validate = false) => {
    let nextLicense = await getStoredLicense() as License | null;
    if (validate && nextLicense) {
      try { nextLicense = await validateLicense() as License; }
      catch { nextLicense = await getStoredLicense() as License | null; }
    }
    setLicense(nextLicense);
    return nextLicense;
  }, []);

  const refreshDevices = useCallback(async () => {
    const currentLicense = await getStoredLicense() as License | null;
    setDeviceError('');
    if (!currentLicense) { setDevices([]); return; }
    try {
      const payload = await listLicenseDevices(currentLicense) as { devices?: Device[] };
      setDevices(payload.devices || []);
    } catch (error) {
      setDevices([]);
      setDeviceError((error as Error).message);
    }
  }, []);

  const refreshPlan = useCallback(async (loadDevices = false) => {
    const nextLicense = await refreshEntitlement();
    const installation = await getInstallation() as { name: string };
    const settings = await getSyncSettings() as SyncSettings | null;
    setDeviceName(nextLicense?.deviceName || installation.name);
    setSyncSettings(settings);
    if (loadDevices && nextLicense) await refreshDevices();
  }, [refreshDevices, refreshEntitlement]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const storedTheme = await chrome.storage.local.get(THEME_KEY);
        if (active) setTheme(storedTheme[THEME_KEY] === 'light' ? 'light' : 'dark');
        const nextLicense = await refreshEntitlement(true);
        const initialState = await getOrMigrateState() as SaverState;
        if (!active) return;
        stateRef.current = initialState;
        setState(initialState);
        await displayState(initialState);
        const installation = await getInstallation() as { name: string };
        setDeviceName(nextLicense?.deviceName || installation.name);
        const settings = await getSyncSettings() as SyncSettings | null;
        setSyncSettings(settings);
        const seen = await chrome.storage.local.get(GUIDE_SEEN_KEY);
        if (!seen[GUIDE_SEEN_KEY]) {
          await chrome.storage.local.set({ [GUIDE_SEEN_KEY]: true });
          setGuideIndex(0);
        }
        if (effectivePlanId(nextLicense) === 'plus' && settings?.enabled) {
          (synchronizeNow() as Promise<SaverState | null>).then((synced) => {
            if (!active || !synced) return;
            stateRef.current = synced;
            setState(synced);
            void displayState(synced);
          }).catch((error: Error) => console.warn('Text Saver cloud sync failed.', error.message));
        }
      } catch (error) {
        console.error('Text Saver could not load saved data.', error);
        if (active) setSaveStatus('error');
      }
    })();
    return () => {
      active = false;
      clearTimeout(saveTimer.current);
      clearTimeout(toastTimer.current);
      lockTimers.current.forEach(clearTimeout);
    };
  }, [displayState, refreshEntitlement]);

  useEffect(() => {
    function onChanged(changes: Record<string, chrome.storage.StorageChange>, area: string) {
      if (area === 'session') {
        Object.entries(changes).forEach(([key, change]) => {
          if (key.startsWith(UNLOCK_PREFIX) && change.newValue === undefined) void lockTabRef.current(key.slice(UNLOCK_PREFIX.length), false);
        });
        return;
      }
      if (area !== 'local') return;
      if (changes.text_saver_license) void refreshEntitlement();
      const incoming = changes.text_saver_state?.newValue as SaverState | undefined;
      if (incoming && isValidState(incoming) && !editPending.current && JSON.stringify(incoming) !== JSON.stringify(stateRef.current)) {
        stateRef.current = clone(incoming);
        setState(clone(incoming));
        void displayState(incoming);
      }
    }
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [displayState, refreshEntitlement]);

  useEffect(() => {
    const flush = () => void flushEditor();
    window.addEventListener('blur', flush);
    window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('blur', flush); window.removeEventListener('pagehide', flush); };
  }, [flushEditor]);

  useEffect(() => {
    function keys(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f' && !promptConfig) {
        event.preventDefault();
        if (!locked) setFindOpen(true);
      }
      if (event.key === 'Escape') {
        setFindOpen(false);
        setContextMenu(null);
      }
    }
    document.addEventListener('keydown', keys);
    return () => document.removeEventListener('keydown', keys);
  }, [locked, promptConfig]);

  async function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    await chrome.storage.local.set({ [THEME_KEY]: next });
  }

  function projectedStateWithText(text: string) {
    const current = stateRef.current;
    if (!current) return null;
    const next = clone(current);
    const tab = next.tabs.find((item) => item.id === next.activeTabId)!;
    if (isEncryptedTab(tab)) {
      const encryptedBytes = new TextEncoder().encode(text).byteLength + 16;
      tab.ciphertext = 'A'.repeat(4 * Math.ceil(encryptedBytes / 3));
    } else tab.text = text;
    return next;
  }

  function limitMessage(text: string) {
    if (text.length > activePlan.maxCharactersPerTab) return `Input blocked: this tab is limited to ${activePlan.maxCharactersPerTab.toLocaleString()} characters`;
    const lines = text ? text.split('\n').length : 0;
    if (lines > activePlan.maxLinesPerTab) return `Input blocked: this tab is limited to ${activePlan.maxLinesPerTab.toLocaleString()} lines`;
    const projected = projectedStateWithText(text);
    if (projected && serializedStateBytes(projected) > activePlan.maxStateBytes) return `Input blocked: ${activePlan.name} storage is limited to ${formatByteSize(activePlan.maxStateBytes)}`;
    return '';
  }

  function handleEditorChange(value: string) {
    const message = limitMessage(value);
    if (message) { showToast(message); return; }
    setEditorText(value);
    editorTextRef.current = value;
    const current = stateRef.current;
    if (current && activeTab && !isEncryptedTab(activeTab)) {
      const next = clone(current);
      (next.tabs.find((tab) => tab.id === next.activeTabId) as { text: string }).text = value;
      stateRef.current = next;
      setState(next);
    } else if (activeTab && isEncryptedTab(activeTab)) {
      unlockedText.current.set(activeTab.id, value);
      void touchUnlock(activeTab);
    }
    editPending.current = true;
    setSaveStatus('saving');
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flushEditor(), AUTOSAVE_DELAY);
    const ratio = Math.max(value.length / activePlan.maxCharactersPerTab, (value ? value.split('\n').length : 0) / activePlan.maxLinesPerTab);
    if (ratio >= .9 && ratio < 1) showToast('Approaching this plan’s per-tab limit');
  }

  async function switchTab(tabId: string) {
    const current = stateRef.current;
    if (!current) return;
    const target = current.tabs.find((tab) => tab.id === tabId);
    if (!target) return;
    if (tabId === current.activeTabId) {
      if (isEncryptedTab(target) && !unlockedKeys.current.has(tabId)) await unlockTab(tabId);
      return;
    }
    await flushEditor();
    const next = clone(stateRef.current!);
    next.activeTabId = tabId;
    stateRef.current = next;
    setState(next);
    await persist(next);
    await displayState(next);
    if (isEncryptedTab(target) && !unlockedKeys.current.has(tabId)) await unlockTab(tabId);
    else setTimeout(() => editorRef.current?.focus());
  }

  async function addTab() {
    const current = stateRef.current;
    if (!current) return;
    if (normalTabCount >= activePlan.maxTabs) return showToast(`${activePlan.name} supports up to ${activePlan.maxTabs} tabs`);
    await flushEditor();
    const next = clone(stateRef.current!);
    const tab = createPlainTab(`Tab ${normalTabCount + 1}`) as SaverTab;
    next.tabs.splice(next.tabs.findIndex(isInbox), 0, tab);
    next.activeTabId = tab.id;
    if (serializedStateBytes(next) > activePlan.maxStateBytes) return showToast(`${activePlan.name} storage limit reached`);
    stateRef.current = next;
    setState(next);
    await persist(next);
    await displayState(next);
    await renameTab(tab.id);
  }

  async function renameTab(tabId: string) {
    const current = stateRef.current;
    const tab = current?.tabs.find((item) => item.id === tabId);
    if (!current || !tab || isInbox(tab)) return;
    const value = await ask({
      title: 'Rename tab', message: 'Enter a new name for this tab.', confirmLabel: 'Rename',
      input: { label: 'Tab name', value: tab.name }, validate: (name) => name.trim() ? null : 'Tab name cannot be empty.',
    });
    if (typeof value !== 'string') return;
    const next = clone(stateRef.current!);
    const renamed = next.tabs.find((item) => item.id === tabId)!;
    renamed.name = value.trim();
    stateRef.current = next;
    setState(next);
    if (isEncryptedTab(renamed) && unlockedKeys.current.has(tabId)) await touchUnlock(renamed);
    await persist(next);
  }

  async function deleteTab(tabId: string) {
    const current = stateRef.current;
    const tab = current?.tabs.find((item) => item.id === tabId);
    if (!current || !tab || isInbox(tab) || normalTabCount === 1) return;
    await flushEditor();
    if (isEncryptedTab(tab) || tab.text) {
      const confirmed = await ask({ title: 'Delete tab?', message: `“${tab.name}” contains saved text. This action cannot be undone.`, confirmLabel: 'Delete' });
      if (!confirmed) return;
    }
    const next = clone(stateRef.current!);
    const index = next.tabs.findIndex((item) => item.id === tabId);
    next.tabs.splice(index, 1);
    if (next.activeTabId === tabId) next.activeTabId = next.tabs[Math.min(index, next.tabs.length - 1)].id;
    await clearUnlockKey(tabId);
    unlockedKeys.current.delete(tabId);
    unlockedText.current.delete(tabId);
    clearTimeout(lockTimers.current.get(tabId));
    stateRef.current = next;
    setState(next);
    await persist(next);
    await displayState(next);
  }

  function passwordValidation(password: string, confirmation: string) {
    if (password.length < MIN_PASSWORD_LENGTH) return 'Password must contain at least 8 characters.';
    return password === confirmation ? null : 'Passwords do not match.';
  }

  async function requestNewPassword(title: string, message: string) {
    return ask({ title, message, confirmLabel: 'Save password', input: { label: 'Password', type: 'password', autocomplete: 'new-password' }, inputTwo: { label: 'Confirm password', type: 'password', autocomplete: 'new-password' }, validate: passwordValidation });
  }

  async function setPassword(tabId: string) {
    const current = stateRef.current;
    const original = current?.tabs.find((tab) => tab.id === tabId);
    if (!current || !original || isInbox(original) || isEncryptedTab(original)) return;
    if (current.activeTabId === tabId) await flushEditor();
    const result = await requestNewPassword('Protect tab', 'Encrypt this tab with a password. Forgotten passwords cannot be recovered.');
    if (!Array.isArray(result)) return;
    const next = clone(stateRef.current!);
    const tab = next.tabs.find((item) => item.id === tabId)!;
    if (isEncryptedTab(tab)) return;
    const plaintext = tab.text;
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKeyBytes(result[0], salt);
    const payload = await encryptText(plaintext, tab.id, key, salt);
    const encrypted = { id: tab.id, name: tab.name, kind: 'normal' as const, protected: true as const, ...payload };
    next.tabs[next.tabs.indexOf(tab)] = encrypted;
    unlockedKeys.current.set(tabId, key);
    unlockedText.current.set(tabId, plaintext);
    stateRef.current = next;
    setState(next);
    await touchUnlock(encrypted);
    await persist(next);
    await displayState(next);
  }

  async function unlockTab(tabId: string) {
    const tab = stateRef.current?.tabs.find((item) => item.id === tabId);
    if (!tab || !isEncryptedTab(tab)) return false;
    let key: Uint8Array | undefined;
    let plaintext = '';
    const result = await ask({
      title: 'Unlock tab', message: `Enter the password for “${tab.name}”.`, confirmLabel: 'Unlock',
      input: { label: 'Password', type: 'password', autocomplete: 'current-password' },
      validate: async (password) => {
        try { key = await deriveKeyBytes(password, base64ToBytes(tab.salt)); plaintext = await decryptText(tab, key); return null; }
        catch { return 'Incorrect password or damaged encrypted data.'; }
      },
    });
    if (result === null || !key) return false;
    unlockedKeys.current.set(tabId, key);
    unlockedText.current.set(tabId, plaintext);
    await touchUnlock(tab);
    if (stateRef.current?.activeTabId === tabId) { setLocked(false); setEditorText(plaintext); editorTextRef.current = plaintext; }
    return true;
  }

  async function verifyPassword(tab: SaverTab, title: string) {
    if (!isEncryptedTab(tab)) return null;
    let key: Uint8Array | undefined;
    let plaintext = '';
    const result = await ask({
      title, message: 'Enter the current password to continue.', confirmLabel: 'Continue',
      input: { label: 'Current password', type: 'password', autocomplete: 'current-password' },
      validate: async (password) => {
        try { key = await deriveKeyBytes(password, base64ToBytes(tab.salt)); plaintext = await decryptText(tab, key); return null; }
        catch { return 'Incorrect password or damaged encrypted data.'; }
      },
    });
    return result === null || !key ? null : { key, plaintext };
  }

  async function securityAction(tabId: string) {
    const tab = stateRef.current?.tabs.find((item) => item.id === tabId);
    if (!tab || isInbox(tab)) return;
    if (!isEncryptedTab(tab)) return setPassword(tabId);
    if (!unlockedKeys.current.has(tabId)) return unlockTab(tabId);
    const choice = await ask({ title: 'Password options', message: `Manage protection for “${tab.name}”.`, options: [
      { label: 'Lock now', value: 'lock' }, { label: 'Change password', value: 'change' }, { label: 'Remove password', value: 'remove' },
    ] });
    if (choice === 'lock') return lockTab(tabId);
    if (choice !== 'change' && choice !== 'remove') return;
    await flushEditor();
    const latest = stateRef.current!.tabs.find((item) => item.id === tabId)!;
    const verified = await verifyPassword(latest, choice === 'change' ? 'Change password' : 'Remove password');
    if (!verified) return;
    const next = clone(stateRef.current!);
    const index = next.tabs.findIndex((item) => item.id === tabId);
    const existing = next.tabs[index];
    if (choice === 'remove') {
      next.tabs[index] = { id: existing.id, name: existing.name, kind: 'normal', protected: false, text: verified.plaintext };
      await clearUnlockKey(tabId);
      unlockedKeys.current.delete(tabId);
      unlockedText.current.delete(tabId);
      clearTimeout(lockTimers.current.get(tabId));
      lockTimers.current.delete(tabId);
    } else {
      const passwords = await requestNewPassword('Choose a new password', 'The tab will be re-encrypted immediately.');
      if (!Array.isArray(passwords) || !isEncryptedTab(existing)) return;
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const key = await deriveKeyBytes(passwords[0], salt);
      Object.assign(existing, await encryptText(verified.plaintext, existing.id, key, salt, existing.encryptionContextId || existing.id));
      unlockedKeys.current.set(tabId, key);
      unlockedText.current.set(tabId, verified.plaintext);
      await touchUnlock(existing);
    }
    stateRef.current = next;
    setState(next);
    await persist(next);
    await displayState(next);
  }

  async function resetProtectedTab(tabId: string) {
    const current = stateRef.current;
    const tab = current?.tabs.find((item) => item.id === tabId);
    if (!current || !tab || !isEncryptedTab(tab)) return;
    const confirmed = await ask({ title: 'Reset protected tab?', message: `The encrypted content in “${tab.name}” will be permanently deleted. The password cannot be recovered.`, confirmLabel: 'Delete encrypted content' });
    if (!confirmed) return;
    const next = clone(current);
    const index = next.tabs.findIndex((item) => item.id === tabId);
    next.tabs[index] = { id: tab.id, name: tab.name, kind: 'normal', protected: false, text: '' };
    await clearUnlockKey(tabId);
    unlockedKeys.current.delete(tabId);
    unlockedText.current.delete(tabId);
    clearTimeout(lockTimers.current.get(tabId));
    lockTimers.current.delete(tabId);
    stateRef.current = next;
    setState(next);
    await persist(next);
    await displayState(next);
  }

  async function copyText(text: string, message: string) {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const temporary = document.createElement('textarea');
      temporary.value = text; temporary.style.position = 'fixed'; temporary.style.opacity = '0';
      document.body.append(temporary); temporary.select(); document.execCommand('copy'); temporary.remove();
    }
    showToast(message);
    if (activeTab && isEncryptedTab(activeTab)) await touchUnlock(activeTab);
  }

  async function downloadText() {
    if (!activeTab || locked) return;
    const now = new Date();
    const filename = `Text Saver - ${now.toLocaleString('en-US', { month: 'long' })} ${now.getDate()} ${now.getFullYear()}.txt`;
    const url = URL.createObjectURL(new Blob([editorText.replace(/\r?\n/g, '\r\n')], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (isEncryptedTab(activeTab)) await touchUnlock(activeTab);
  }

  function navigateFind(direction: number) {
    if (!matches.length) return;
    const next = findIndex < 0 ? (direction < 0 ? matches.length - 1 : 0) : (findIndex + direction + matches.length) % matches.length;
    setFindIndex(next);
    const match = matches[next];
    editorRef.current?.focus();
    editorRef.current?.setSelectionRange(match.start, match.end);
  }

  async function exportBackup() {
    await flushEditor();
    const backup = { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), state: clone(stateRef.current) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `text-saver-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Backup exported');
  }

  function backupTabSize(tab: SaverTab) {
    if (!isEncryptedTab(tab)) return `${tab.text.length.toLocaleString()} characters`;
    const padding = tab.ciphertext.endsWith('==') ? 2 : tab.ciphertext.endsWith('=') ? 1 : 0;
    return `${formatByteSize(Math.max(0, Math.floor(tab.ciphertext.length * 3 / 4) - padding))} encrypted`;
  }

  async function importBackup(file?: File) {
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES) return showToast('Backup is too large');
    let backup: { format: string; version: number; state: SaverState };
    try { backup = JSON.parse(await file.text()); }
    catch { return showToast('Could not read this backup'); }
    if (backup?.format !== BACKUP_FORMAT || backup.version !== BACKUP_VERSION || !isValidState(backup.state)) return showToast('Invalid or unsupported backup');
    const current = stateRef.current!;
    const importedTabs = backup.state.tabs.filter((tab) => !isInbox(tab));
    const existingIds = new Set(current.tabs.map((tab) => tab.id));
    const availableSlots = Math.max(0, activePlan.maxTabs - normalTabCount);
    let ready = 0;
    const preview = backup.state.tabs.map((tab) => {
      let status = 'Ready', conflict = false;
      if (isInbox(tab)) status = 'Replace only';
      else if (existingIds.has(tab.id)) { status = 'Already exists'; conflict = true; }
      else if (ready >= availableSlots) { status = 'Tab limit'; conflict = true; }
      else ready += 1;
      return { name: tab.name, protected: isEncryptedTab(tab), size: backupTabSize(tab), status, conflict };
    });
    const choice = await ask({ title: 'Import backup', message: `Review ${importedTabs.length} saved ${importedTabs.length === 1 ? 'tab' : 'tabs'} before choosing how to import them.`, preview, options: [
      { label: `Merge ${ready} available ${ready === 1 ? 'tab' : 'tabs'}`, value: 'merge', disabled: ready === 0 },
      { label: 'Replace current tabs', value: 'replace' },
    ] });
    if (!choice) return;
    await flushEditor();
    let next: SaverState;
    let importedCount = importedTabs.length;
    if (choice === 'replace') next = clone(backup.state);
    else {
      const additions = importedTabs.filter((tab) => !existingIds.has(tab.id)).slice(0, availableSlots).map(clone);
      importedCount = additions.length;
      if (!importedCount) return showToast(availableSlots ? 'These tabs are already imported' : 'Tab limit reached');
      next = clone(stateRef.current!);
      next.tabs.splice(next.tabs.findIndex(isInbox), 0, ...additions);
      if (serializedStateBytes(next) > activePlan.maxStateBytes) return showToast(`${activePlan.name} storage limit reached`);
    }
    const ids = new Set([...stateRef.current!.tabs, ...next.tabs].map((tab) => tab.id));
    await Promise.all([...ids].map(clearUnlockKey));
    unlockedKeys.current.clear(); unlockedText.current.clear(); lockTimers.current.forEach(clearTimeout); lockTimers.current.clear();
    stateRef.current = next; setState(next); await persist(next); await displayState(next);
    showToast(choice === 'replace' ? (serializedStateBytes(next) > activePlan.maxStateBytes ? 'Backup restored read-only until usage is within plan limits' : 'Backup restored') : `${importedCount} ${importedCount === 1 ? 'tab' : 'tabs'} imported`);
  }

  async function openPlans() { await flushEditor(); setLicenseError(''); setPlanOpen(true); await refreshPlan(true); }

  async function handleActivation() {
    const key = licenseInput.trim();
    if (!key) return setLicenseError('Enter the license key from your Creem receipt.');
    setPlanBusy(true); setLicenseError('');
    const oldLicense = await getStoredLicense() as License | null;
    try {
      const nextLicense = await activateLicense(key, deviceName) as License;
      if (oldLicense && oldLicense.installationToken !== nextLicense.installationToken) {
        await disableCloudSync();
        try { await deactivateInstallation(oldLicense, oldLicense.installationId, false); }
        catch { setLicenseError('New plan activated, but the previous license still uses a device slot.'); }
      }
      setLicenseInput(''); await refreshPlan(true); showToast(`${currentPlan(nextLicense).name} activated`);
    } catch (error) {
      const typed = error as InstanceType<typeof LicenseApiError> & { details?: { devices?: Device[] } };
      setLicenseError(error instanceof LicenseApiError ? typed.message : 'Activation failed. Try again.');
      if (typed.details?.devices) { setDevices(typed.details.devices); }
    } finally { setPlanBusy(false); }
  }

  async function handleValidation() {
    setPlanBusy(true); setLicenseError('');
    try { await validateLicense({ force: true }); await refreshPlan(true); showToast('License validated'); }
    catch (error) { setLicenseError((error as Error).message); await refreshPlan(); }
    finally { setPlanBusy(false); }
  }

  async function deactivateDevice(device: Device) {
    const currentLicense = await getStoredLicense() as License | null;
    if (!currentLicense) return;
    const confirmed = await ask({ title: 'Deactivate device?', message: `This frees the activation used by “${device.deviceName}”. Local notes will not be deleted.`, confirmLabel: 'Deactivate' });
    if (!confirmed) return;
    setPlanBusy(true);
    try {
      await deactivateInstallation(currentLicense, device.installationId, true);
      if (device.installationId === currentLicense.installationId) await disableCloudSync();
      await refreshPlan(true); showToast('Device deactivated');
    } catch (error) { setLicenseError((error as Error).message); }
    finally { setPlanBusy(false); }
  }

  async function deactivateCurrent() {
    if (!license) return;
    const confirmed = await ask({ title: 'Deactivate this device?', message: 'This frees one activation. Local notes remain available on the Free plan.', confirmLabel: 'Deactivate' });
    if (!confirmed) return;
    setPlanBusy(true);
    try { await deactivateInstallation(license); await disableCloudSync(); await refreshPlan(); showToast('Device deactivated'); }
    catch (error) { setLicenseError((error as Error).message); }
    finally { setPlanBusy(false); }
  }

  async function requestSyncPassword(title: string) {
    return ask({ title, message: 'Use the same password on both devices. Text Saver cannot recover it.', confirmLabel: 'Continue', input: { label: 'Sync password', type: 'password', autocomplete: 'new-password' }, inputTwo: { label: 'Confirm sync password', type: 'password', autocomplete: 'new-password' }, validate: (password, confirmation) => password.length < 12 ? 'Use at least 12 characters.' : password === confirmation ? null : 'Passwords do not match.' });
  }

  async function setupSync(reset = false) {
    const result = await requestSyncPassword(reset ? 'Reset encrypted cloud copy' : 'Set up encrypted sync');
    if (!Array.isArray(result)) return;
    setPlanBusy(true); setLicenseError('');
    try {
      await flushEditor();
      const synced = (reset ? await resetCloudSync(result[0]) : await enableCloudSync(result[0])) as SaverState;
      stateRef.current = synced; setState(synced); await displayState(synced); await refreshPlan();
      showToast(reset ? 'Cloud copy reset' : 'Cloud sync enabled');
    } catch (error) { setLicenseError((error as Error).message); }
    finally { setPlanBusy(false); }
  }

  async function syncNow() {
    setPlanBusy(true); setLicenseError('');
    try {
      await flushEditor(); const synced = await synchronizeNow() as SaverState | null;
      if (synced) { stateRef.current = synced; setState(synced); await displayState(synced); }
      await refreshPlan(); showToast('Cloud sync complete');
    } catch (error) { setLicenseError((error as Error).message); await refreshPlan(); }
    finally { setPlanBusy(false); }
  }

  async function turnOffSync() {
    const choice = await ask({ title: 'Turn off cloud sync?', message: 'Your local notes remain on this device.', options: [
      { label: 'Keep encrypted cloud copy', value: 'keep' }, { label: 'Delete encrypted cloud copy', value: 'delete' },
    ] });
    if (!choice) return;
    setPlanBusy(true);
    try { await disableCloudSync({ deleteRemote: choice === 'delete' }); await refreshPlan(); showToast('Cloud sync turned off'); }
    catch (error) { setLicenseError((error as Error).message); }
    finally { setPlanBusy(false); }
  }

  async function reorderTabs(list: SaverTab[]) {
    const current = stateRef.current;
    if (!current || list.length !== current.tabs.length || list.every((tab, index) => tab.id === current.tabs[index].id)) return;
    await flushEditor();
    const byId = new Map(stateRef.current!.tabs.map((tab) => [tab.id, tab]));
    const next = { ...stateRef.current!, tabs: list.map((tab) => clone(byId.get(tab.id)!)) };
    stateRef.current = next; setState(next); await persist(next);
  }

  if (!state || !activeTab) {
    return <div className="grid h-[590px] w-[760px] place-items-center bg-background text-base text-muted-foreground"><Cloud className="size-6 animate-pulse" />Loading Text Saver…</div>;
  }

  const lineItems = editorText.split('\n');
  const contextTab = contextMenu ? state.tabs.find((tab) => tab.id === contextMenu.tabId) : null;

  return (
    <main className="relative flex h-[590px] w-[760px] flex-col overflow-hidden bg-background p-4 text-foreground" onClick={() => setContextMenu(null)}>
      <header className="flex min-h-12 items-center justify-between border-b border-border pb-2.5">
        <div className="brand flex items-center gap-2.5">
          <img src="/images/128.png" alt="Text Saver" className="size-8 rounded-md" />
          <div>
            <div className="text-[17px] font-bold leading-tight">Text Saver</div>
            <div className="text-[10px] uppercase tracking-[.18em] text-muted-foreground">{activePlan.name} plan</div>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <span className={cn('mr-1 text-[11px] text-muted-foreground', saveStatus === 'error' && 'text-destructive')}>{saveStatus === 'saving' ? 'Saving…' : saveStatus === 'error' ? 'Save failed' : ''}</span>
          <Button variant="ghost" size="icon" title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} onClick={() => void toggleTheme()}>{theme === 'dark' ? <Sun /> : <Moon />}</Button>
          <Button variant="ghost" size="icon" title="Find in tab" onClick={() => locked ? showToast('Unlock this tab to search') : setFindOpen(true)}><Search /></Button>
          {!isInbox(activeTab) && <>
            <Button variant="ghost" size="icon" title={isEncryptedTab(activeTab) ? (locked ? 'Unlock tab' : 'Password options') : 'Set password'} onClick={() => void securityAction(activeTab.id)}>{isEncryptedTab(activeTab) && locked ? <Unlock /> : <Lock />}</Button>
            <Button variant="ghost" size="icon" title={`Rename ${activeTab.name}`} onClick={() => void renameTab(activeTab.id)}><Pencil /></Button>
            <Button variant="ghost" size="icon" title={`Delete ${activeTab.name}`} disabled={normalTabCount === 1} onClick={() => void deleteTab(activeTab.id)}><Trash2 /></Button>
          </>}
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="More options"><Ellipsis /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void openPlans()}><Cloud />Plan &amp; cloud</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setGuideIndex(0)}><HelpCircle />Guide</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void exportBackup()}><FileUp />Export backup</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => backupInputRef.current?.click()}><FileDown />Import backup</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild><a href="https://bit.ly/4xDbvkk" target="_blank" rel="noreferrer"><KeyRound />Developer</a></DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <input ref={backupInputRef} hidden type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; void importBackup(file); }} />
        </div>
      </header>

      <div className="tabs-toolbar mt-2.5 flex min-h-10 items-start gap-1.5">
        <ReactSortable
          list={state.tabs.map((tab) => ({ ...tab })) as (SaverTab & { chosen?: boolean; selected?: boolean })[]}
          setList={(list) => void reorderTabs(list)}
          animation={160}
          delay={80}
          delayOnTouchOnly
          direction="horizontal"
          className="flex flex-1 gap-1.5 overflow-x-auto pb-1"
        >
          {state.tabs.map((tab) => (
            <div
              key={tab.id}
              data-id={tab.id}
              className={cn('group flex max-w-44 shrink-0 cursor-grab items-center rounded-md border bg-card text-muted-foreground transition-colors', tab.id === state.activeTabId && 'border-primary/35 bg-accent text-foreground', isInbox(tab) && 'border-amber-500/40')}
              onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setContextMenu({ tabId: tab.id, x: event.clientX, y: event.clientY }); }}
            >
              <button className="flex min-w-0 items-center gap-2 px-3.5 py-2.5 text-[13px]" title={tab.name} onClick={() => void switchTab(tab.id)}>
                {isInbox(tab) ? <Inbox className="size-3.5 shrink-0 text-amber-500" /> : isEncryptedTab(tab) ? (unlockedKeys.current.has(tab.id) ? <Unlock className="size-3.5 shrink-0" /> : <Lock className="size-3.5 shrink-0" />) : null}
                <span className="truncate">{tab.name}</span>
              </button>
            </div>
          ))}
        </ReactSortable>
        <Button variant="outline" size="icon" className="size-9 shrink-0" title="Add tab" disabled={normalTabCount >= activePlan.maxTabs} onClick={() => void addTab()}><Plus /></Button>
      </div>

      <section className="relative mt-1 flex min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-card shadow-inner">
        {locked ? (
          <div className="absolute inset-0 z-10 grid place-items-center bg-card">
            <div className="text-center">
              <div className="mx-auto mb-3 grid size-12 place-items-center rounded-full border border-border bg-muted"><Lock className="size-5 text-muted-foreground" /></div>
              <h2 className="text-sm font-semibold">This tab is locked</h2>
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={() => void unlockTab(activeTab.id)}><Unlock />Unlock</Button>
                <Button size="sm" variant="outline" onClick={() => void resetProtectedTab(activeTab.id)}>Forgot password</Button>
              </div>
            </div>
          </div>
        ) : null}

        {!locked && (
          <div ref={gutterRef} className="line-gutter w-12 shrink-0 overflow-hidden border-r border-border bg-muted/25 py-2.5 text-right font-mono text-[12px] leading-5 text-muted-foreground/60">
            {lineItems.map((line, index) => (
              <button key={index} style={{ height: lineHeights[index] || 20 }} className="group/line flex w-full items-start justify-end px-2.5 pt-px hover:bg-accent hover:text-foreground" title={`Copy line ${index + 1}`} onClick={() => void copyText(line, `Line ${index + 1} copied to clipboard`)}>
                <span className="group-hover/line:hidden">{index + 1}</span><Copy className="hidden size-3 group-hover/line:block" />
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={editorRef}
          value={editorText}
          disabled={locked}
          maxLength={Math.max(activePlan.maxCharactersPerTab, editorText.length)}
          placeholder="Write something great today..."
          className="min-w-0 flex-1 resize-none bg-card px-3.5 py-2.5 font-sans text-[14px] leading-5 text-foreground outline-none placeholder:text-muted-foreground/60 disabled:opacity-0"
          onChange={(event) => handleEditorChange(event.target.value)}
          onScroll={(event) => { if (gutterRef.current) gutterRef.current.scrollTop = event.currentTarget.scrollTop; }}
          onKeyDown={(event) => {
            if (!findOpen) return;
            if (event.key === 'Enter') { event.preventDefault(); navigateFind(event.shiftKey ? -1 : 1); }
            if (event.key === 'Escape') { event.preventDefault(); setFindOpen(false); }
          }}
        />

        {findOpen && !locked && (
          <div className="absolute right-2 top-2 flex items-center gap-1 rounded-lg border border-border bg-popover p-1 shadow-xl">
            <Input autoFocus className="h-8 w-40" type="search" placeholder="Find" value={findQuery} onChange={(event) => { setFindQuery(event.target.value); setFindIndex(-1); }} onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); navigateFind(event.shiftKey ? -1 : 1); }
              if (event.key === 'Escape') setFindOpen(false);
            }} />
            <span className="min-w-10 text-center text-[11px] text-muted-foreground">{matches.length ? `${Math.max(0, findIndex + 1)}/${matches.length}` : '0/0'}</span>
            <Button size="icon" variant="ghost" className="size-8" disabled={!matches.length} onClick={() => navigateFind(-1)}><ArrowUp /></Button>
            <Button size="icon" variant="ghost" className="size-8" disabled={!matches.length} onClick={() => navigateFind(1)}><ArrowDown /></Button>
            <Button size="icon" variant="ghost" className="size-8" onClick={() => setFindOpen(false)}><X /></Button>
          </div>
        )}
      </section>

      <footer className="mt-2 flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2">
        <div className="flex gap-2.5 text-[12px] text-muted-foreground">
          <span>{stats.words.toLocaleString()} words</span><span>·</span><span>{stats.characters.toLocaleString()} characters</span><span>·</span><span>{stats.lines.toLocaleString()} lines</span>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={locked} onClick={() => void downloadText()}><Download />Download</Button>
          <Button size="sm" disabled={locked} onClick={() => void copyText(editorText, 'Copied to clipboard')}><Clipboard />Copy</Button>
        </div>
      </footer>

      {contextMenu && contextTab && (
        <div className="fixed z-50 w-44 rounded-lg border border-border bg-popover p-1.5 shadow-xl" style={{ left: Math.min(contextMenu.x, 580), top: Math.min(contextMenu.y, 470) }} onClick={(event) => event.stopPropagation()}>
          <button disabled={isInbox(contextTab)} className="context-item" onClick={() => { setContextMenu(null); void renameTab(contextTab.id); }}><Pencil />Rename</button>
          <button disabled={isInbox(contextTab)} className="context-item" onClick={() => {
            setContextMenu(null);
            if (isEncryptedTab(contextTab) && unlockedKeys.current.has(contextTab.id)) void lockTab(contextTab.id);
            else void securityAction(contextTab.id);
          }}>
            {isEncryptedTab(contextTab) && !unlockedKeys.current.has(contextTab.id) ? <Unlock /> : <Lock />}{!isEncryptedTab(contextTab) ? 'Set password' : unlockedKeys.current.has(contextTab.id) ? 'Lock now' : 'Unlock'}
          </button>
          <button disabled={isInbox(contextTab) || normalTabCount === 1} className="context-item text-destructive" onClick={() => { setContextMenu(null); void deleteTab(contextTab.id); }}><Trash2 />Delete tab</button>
        </div>
      )}

      <PlanPanel
        open={planOpen} onClose={() => setPlanOpen(false)} plan={activePlan}
        usage={`${normalTabCount} / ${activePlan.maxTabs} tabs · ${formatByteSize(serializedStateBytes(state))} / ${formatByteSize(activePlan.maxStateBytes)}`}
        license={license} licenseStatus={licenseStatusText(license)} licenseKey={licenseInput} setLicenseKey={setLicenseInput}
        deviceName={deviceName} setDeviceName={setDeviceName} devices={devices} deviceError={deviceError}
        error={licenseError} busy={planBusy} syncSettings={syncSettings}
        onActivate={() => void handleActivation()} onValidate={() => void handleValidation()} onDeactivateCurrent={() => void deactivateCurrent()}
        onRefreshDevices={() => void refreshDevices()} onDeactivateDevice={(device) => void deactivateDevice(device)}
        onSetupSync={(reset) => void setupSync(reset)} onSyncNow={() => void syncNow()} onDisableSync={() => void turnOffSync()}
      />

      <PromptDialog config={promptConfig} onResolve={resolvePrompt} />

      {guideIndex !== null && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-6 backdrop-blur-sm">
          <section className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between"><span className="text-[11px] uppercase tracking-[.18em] text-amber-500">Guide {guideIndex + 1} of {GUIDE_STEPS.length}</span><HelpCircle className="size-5 text-muted-foreground" /></div>
            <h2 className="text-lg font-semibold">{GUIDE_STEPS[guideIndex][0]}</h2>
            <p className="mt-2 min-h-12 text-[13px] leading-relaxed text-muted-foreground">{GUIDE_STEPS[guideIndex][1]}</p>
            <div className="mt-5 flex items-center justify-between">
              <Button variant="ghost" size="sm" onClick={() => setGuideIndex(null)}>Skip</Button>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={guideIndex === 0} onClick={() => setGuideIndex(Math.max(0, guideIndex - 1))}>Back</Button>
                <Button size="sm" onClick={() => guideIndex === GUIDE_STEPS.length - 1 ? setGuideIndex(null) : setGuideIndex(guideIndex + 1)}>{guideIndex === GUIDE_STEPS.length - 1 ? <><Check />Done</> : 'Next'}</Button>
              </div>
            </div>
          </section>
        </div>
      )}

      <div className={cn('pointer-events-none fixed bottom-20 left-1/2 z-[70] -translate-x-1/2 translate-y-2 rounded-lg border border-border bg-popover px-3.5 py-2.5 text-[13px] opacity-0 shadow-xl transition-all', toast && 'translate-y-0 opacity-100')}>{toast}</div>
    </main>
  );
}
