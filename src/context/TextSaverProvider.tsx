import { TextSaverContext } from "@/context/TextSaverContext";
import { useLineHeights } from "@/hooks/use-line-heights";
import { usePrompt } from "@/hooks/use-prompt";
import { useProductTour } from "@/hooks/use-product-tour";
import { useToast } from "@/hooks/use-toast";
import {
  deferCloudSync,
  disableCloudSync,
  enableCloudSync,
  getSyncSettings,
  mergeStates,
  resetCloudSync,
  SYNC_KEY,
  setSyncedTabIds,
  syncNow as synchronizeNow,
} from "@/lib/cloud-sync.js";
import {
  LICENSE_KEY,
  LicenseApiError,
  activateLicense,
  currentPlan,
  deactivateDevice as deactivateLicenseDevice,
  deactivateInstallation,
  effectivePlanId,
  getInstallation,
  getStoredLicense,
  listDevices,
  revokeDevice as revokeLicenseDevice,
  validateLicense,
} from "@/lib/licensing.js";
import { getPlanLimits, serializedStateBytes } from "@/lib/plans.js";
import {
  AUTO_SYNC_DELAY,
  AUTOSAVE_DELAY,
  BACKUP_FORMAT,
  BACKUP_VERSION,
  GUIDE_SEEN_KEY,
  MAX_BACKUP_BYTES,
  MIN_PASSWORD_LENGTH,
  THEME_KEY,
} from "@/lib/app-config";
import {
  clone,
  findTextMatches,
  formatByteSize,
  isEncryptedTab,
  isInbox,
  textStats,
} from "@/lib/app-utils";
import {
  UNLOCK_MS,
  UNLOCK_PREFIX,
  base64ToBytes,
  cacheUnlockKey,
  clearUnlockKey,
  createPlainTab,
  decryptText,
  deriveKeyBytes,
  encryptText,
  getCachedUnlockKey,
  getOrMigrateState,
  isValidState,
  saveState,
} from "@/lib/storage.js";
import type {
  License,
  LicenseDevice,
  Plan,
  SaverState,
  SaverTab,
  SyncSettings,
  TabContextPosition,
} from "@/types";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export function TextSaverProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SaverState | null>(null);
  const stateRef = useRef<SaverState | null>(null);
  const [editorText, setEditorText] = useState("");
  const editorTextRef = useRef("");
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const [locked, setLocked] = useState(false);
  const unlockedKeys = useRef(new Map<string, Uint8Array>());
  const unlockedText = useRef(new Map<string, string>());
  const lockTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const lockTabRef = useRef<
    (tabId: string, clearSession?: boolean) => Promise<void>
  >(async () => undefined);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "error">(
    "idle",
  );
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const cloudSyncTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const cloudSyncPending = useRef(false);
  const cloudSyncInFlight = useRef<Promise<void> | null>(null);
  const saveQueue = useRef(Promise.resolve());
  const editPending = useRef(false);
  const { toast, showToast } = useToast();
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findIndex, setFindIndex] = useState(-1);
  const [planOpen, setPlanOpen] = useState(false);
  const [license, setLicense] = useState<License | null>(null);
  const [syncSettings, setSyncSettings] = useState<SyncSettings | null>(null);
  const [licenseError, setLicenseError] = useState("");
  const [licenseInput, setLicenseInput] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [planBusy, setPlanBusy] = useState(false);
  const [devices, setDevices] = useState<LicenseDevice[]>([]);
  const [deviceLimit, setDeviceLimit] = useState(0);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const { promptConfig, ask, resolvePrompt } = usePrompt();
  const [contextMenu, setContextMenu] = useState<TabContextPosition | null>(
    null,
  );
  const startGuide = useProductTour();

  const activeTab = useMemo(
    () =>
      state?.tabs.find((tab) => tab.id === state.activeTabId) || state?.tabs[0],
    [state],
  );
  const planId = effectivePlanId(license) as "free" | "plus";
  const activePlan = getPlanLimits(planId) as Plan;
  const normalTabCount = state?.tabs.filter((tab) => !isInbox(tab)).length || 0;
  const stats = useMemo(() => textStats(editorText), [editorText]);
  const matches = useMemo(
    () => findTextMatches(editorText, findQuery),
    [editorText, findQuery],
  );
  const syncedTabIds = useMemo(
    () => new Set(syncSettings?.selectedTabIds || []),
    [syncSettings],
  );
  const { gutterRef, lineHeights } = useLineHeights(
    editorRef,
    editorText,
    locked,
    state?.activeTabId,
  );

  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    editorTextRef.current = editorText;
  }, [editorText]);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const persist = useCallback((snapshot: SaverState, indicate = false) => {
    clearTimeout(saveTimer.current);
    if (indicate) setSaveStatus("saving");
    saveQueue.current = saveQueue.current
      .catch(() => undefined)
      .then(() => saveState(clone(snapshot)));
    return saveQueue.current
      .then(() => indicate && setSaveStatus("idle"))
      .catch((error) => {
        setSaveStatus("error");
        throw error;
      });
  }, []);

  const touchUnlock = useCallback(async (tab: SaverTab) => {
    if (!isEncryptedTab(tab)) return;
    const key = unlockedKeys.current.get(tab.id);
    if (!key) return;
    clearTimeout(lockTimers.current.get(tab.id));
    const expiresAt = await cacheUnlockKey(tab.id, key, Date.now() + UNLOCK_MS);
    lockTimers.current.set(
      tab.id,
      setTimeout(
        () => void lockTabRef.current(tab.id),
        Math.max(0, expiresAt - Date.now()),
      ),
    );
  }, []);

  const flushEditor = useCallback(async () => {
    const current = stateRef.current;
    if (!current) return;
    const next = clone(current);
    const tab = next.tabs.find((item) => item.id === next.activeTabId);
    if (!tab || (isEncryptedTab(tab) && !unlockedKeys.current.has(tab.id)))
      return persist(next);
    if (isEncryptedTab(tab)) {
      const key = unlockedKeys.current.get(tab.id)!;
      const payload = await encryptText(
        editorTextRef.current,
        tab.id,
        key,
        base64ToBytes(tab.salt),
        tab.encryptionContextId || tab.id,
      );
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

  const displayState = useCallback(
    async (nextState: SaverState) => {
      const tab =
        nextState.tabs.find((item) => item.id === nextState.activeTabId) ||
        nextState.tabs[0];
      let available = !isEncryptedTab(tab) || unlockedKeys.current.has(tab.id);
      if (isEncryptedTab(tab) && !available) {
        const cached = await getCachedUnlockKey(tab.id);
        if (cached) {
          try {
            const text = await decryptText(tab, cached.keyBytes);
            unlockedKeys.current.set(tab.id, cached.keyBytes);
            unlockedText.current.set(tab.id, text);
            lockTimers.current.set(
              tab.id,
              setTimeout(
                () => void lockTabRef.current(tab.id),
                Math.max(0, cached.expiresAt - Date.now()),
              ),
            );
            available = true;
          } catch {
            await clearUnlockKey(tab.id);
          }
        }
      }
      setLocked(isEncryptedTab(tab) && !available);
      const text = isEncryptedTab(tab)
        ? available
          ? unlockedText.current.get(tab.id) || ""
          : ""
        : tab.text;
      editorTextRef.current = text;
      setEditorText(text);
      setFindIndex(-1);
      if (isEncryptedTab(tab) && available) await touchUnlock(tab);
    },
    [touchUnlock],
  );

  const lockTab = useCallback(
    async (tabId: string, clearSession = true) => {
      const current = stateRef.current;
      const tab = current?.tabs.find((item) => item.id === tabId);
      if (
        !current ||
        !tab ||
        !isEncryptedTab(tab) ||
        !unlockedKeys.current.has(tabId)
      )
        return;
      if (tab.id === current.activeTabId) await flushEditor();
      clearTimeout(lockTimers.current.get(tabId));
      lockTimers.current.delete(tabId);
      unlockedKeys.current.delete(tabId);
      unlockedText.current.delete(tabId);
      if (clearSession) await clearUnlockKey(tabId);
      if (tab.id === current.activeTabId) {
        setLocked(true);
        setEditorText("");
        editorTextRef.current = "";
      }
    },
    [flushEditor],
  );
  useEffect(() => {
    lockTabRef.current = lockTab;
  }, [lockTab]);

  const clearUnlocks = useCallback(async (tabIds: Iterable<string>) => {
    const ids = [...new Set(tabIds)];
    await Promise.all(ids.map(clearUnlockKey));
    ids.forEach((tabId) => {
      unlockedKeys.current.delete(tabId);
      unlockedText.current.delete(tabId);
      clearTimeout(lockTimers.current.get(tabId));
      lockTimers.current.delete(tabId);
    });
  }, []);

  const applyIncomingState = useCallback(
    async (next: SaverState) => {
      const previousById = new Map(
        (stateRef.current?.tabs || []).map((tab) => [tab.id, tab]),
      );
      const changedProtectedIds = next.tabs
        .filter((tab) => {
          const previous = previousById.get(tab.id);
          return (
            (isEncryptedTab(tab) || isEncryptedTab(previous)) &&
            JSON.stringify(tab) !== JSON.stringify(previous)
          );
        })
        .map((tab) => tab.id);
      await clearUnlocks(changedProtectedIds);
      stateRef.current = next;
      setState(next);
      await displayState(next);
    },
    [clearUnlocks, displayState],
  );

  const refreshEntitlement = useCallback(async (validate = false) => {
    let nextLicense = (await getStoredLicense()) as License | null;
    if (validate && nextLicense) {
      try {
        nextLicense = (await validateLicense()) as License;
      } catch {
        nextLicense = (await getStoredLicense()) as License | null;
      }
    }
    setLicense(nextLicense);
    return nextLicense;
  }, []);

  const refreshPlan = useCallback(async () => {
    const nextLicense = await refreshEntitlement();
    const installation = (await getInstallation()) as { name: string };
    const settings = (await getSyncSettings()) as SyncSettings | null;
    setDeviceName(nextLicense?.deviceName || installation.name);
    setSyncSettings(settings);
  }, [refreshEntitlement]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const storedTheme = await chrome.storage.local.get(THEME_KEY);
        if (active)
          setTheme(storedTheme[THEME_KEY] === "light" ? "light" : "dark");
        const nextLicense = await refreshEntitlement(true);
        let initialState = (await getOrMigrateState()) as SaverState;
        const settings = (await getSyncSettings()) as SyncSettings | null;
        if (
          effectivePlanId(nextLicense) === "plus" &&
          settings?.enabled &&
          navigator.onLine
        ) {
          try {
            initialState =
              ((await synchronizeNow()) as SaverState) || initialState;
          } catch (error) {
            if (error instanceof LicenseApiError && error.isTemporary) {
              await deferCloudSync(
                "Offline or server unavailable · changes are safe locally and will retry.",
              );
            } else {
              setLicenseError((error as Error).message);
            }
          }
        }
        if (!active) return;
        stateRef.current = initialState;
        setState(initialState);
        await displayState(initialState);
        const installation = (await getInstallation()) as { name: string };
        setDeviceName(nextLicense?.deviceName || installation.name);
        setSyncSettings((await getSyncSettings()) as SyncSettings | null);
        const seen = await chrome.storage.local.get(GUIDE_SEEN_KEY);
        if (!seen[GUIDE_SEEN_KEY]) {
          await chrome.storage.local.set({ [GUIDE_SEEN_KEY]: true });
          startGuide();
        }
      } catch (error) {
        console.error("Text Saver could not load saved data.", error);
        if (active) setSaveStatus("error");
      }
    })();
    return () => {
      active = false;
      clearTimeout(saveTimer.current);
      clearTimeout(cloudSyncTimer.current);
      lockTimers.current.forEach(clearTimeout);
    };
  }, [applyIncomingState, displayState, refreshEntitlement, startGuide]);

  useEffect(() => {
    function onChanged(
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) {
      if (area === "session") {
        Object.entries(changes).forEach(([key, change]) => {
          if (key.startsWith(UNLOCK_PREFIX) && change.newValue === undefined)
            void lockTabRef.current(key.slice(UNLOCK_PREFIX.length), false);
        });
        return;
      }
      if (area !== "local") return;
      if (changes[LICENSE_KEY]) void refreshEntitlement();
      if (changes[SYNC_KEY])
        setSyncSettings(
          (changes[SYNC_KEY].newValue as SyncSettings | undefined) || null,
        );
      const incoming = changes.text_saver_state?.newValue as
        SaverState | undefined;
      if (
        incoming &&
        isValidState(incoming) &&
        !editPending.current &&
        !cloudSyncInFlight.current &&
        JSON.stringify(incoming) !== JSON.stringify(stateRef.current)
      ) {
        void applyIncomingState(clone(incoming));
      }
    }
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [applyIncomingState, refreshEntitlement]);

  useEffect(() => {
    const flush = () => void flushEditor();
    window.addEventListener("blur", flush);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("blur", flush);
      window.removeEventListener("pagehide", flush);
    };
  }, [flushEditor]);

  useEffect(() => {
    function keys(event: KeyboardEvent) {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "f" &&
        !promptConfig
      ) {
        event.preventDefault();
        if (!locked) setFindOpen(true);
      }
      if (event.key === "Escape") {
        setFindOpen(false);
        setContextMenu(null);
      }
    }
    document.addEventListener("keydown", keys);
    return () => document.removeEventListener("keydown", keys);
  }, [locked, promptConfig]);

  async function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
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
      tab.ciphertext = "A".repeat(4 * Math.ceil(encryptedBytes / 3));
    } else tab.text = text;
    return next;
  }

  function limitMessage(text: string) {
    if (text.length > activePlan.maxCharactersPerTab)
      return `Input blocked: this tab is limited to ${activePlan.maxCharactersPerTab.toLocaleString()} characters`;
    const lines = text ? text.split("\n").length : 0;
    if (lines > activePlan.maxLinesPerTab)
      return `Input blocked: this tab is limited to ${activePlan.maxLinesPerTab.toLocaleString()} lines`;
    const projected = projectedStateWithText(text);
    if (projected && serializedStateBytes(projected) > activePlan.maxStateBytes)
      return `Input blocked: ${activePlan.name} storage is limited to ${formatByteSize(activePlan.maxStateBytes)}`;
    return "";
  }

  function handleEditorChange(value: string) {
    const message = limitMessage(value);
    if (message) {
      showToast(message);
      return;
    }
    setEditorText(value);
    editorTextRef.current = value;
    const current = stateRef.current;
    if (current && activeTab && !isEncryptedTab(activeTab)) {
      const next = clone(current);
      (
        next.tabs.find((tab) => tab.id === next.activeTabId) as { text: string }
      ).text = value;
      stateRef.current = next;
      setState(next);
    } else if (activeTab && isEncryptedTab(activeTab)) {
      unlockedText.current.set(activeTab.id, value);
      void touchUnlock(activeTab);
    }
    editPending.current = true;
    setSaveStatus("saving");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flushEditor(), AUTOSAVE_DELAY);
    if (syncSettings?.enabled && activeTab && syncedTabIds.has(activeTab.id))
      queueCloudSync();
    const ratio = Math.max(
      value.length / activePlan.maxCharactersPerTab,
      (value ? value.split("\n").length : 0) / activePlan.maxLinesPerTab,
    );
    if (ratio >= 0.9 && ratio < 1)
      showToast("Approaching this plan’s per-tab limit");
  }

  async function switchTab(tabId: string) {
    const current = stateRef.current;
    if (!current) return;
    const target = current.tabs.find((tab) => tab.id === tabId);
    if (!target) return;
    if (tabId === current.activeTabId) {
      if (isEncryptedTab(target) && !unlockedKeys.current.has(tabId))
        await unlockTab(tabId);
      return;
    }
    await flushEditor();
    const next = clone(stateRef.current!);
    next.activeTabId = tabId;
    stateRef.current = next;
    setState(next);
    await persist(next);
    await displayState(next);
    if (isEncryptedTab(target) && !unlockedKeys.current.has(tabId))
      await unlockTab(tabId);
    else setTimeout(() => editorRef.current?.focus());
  }

  async function addTab() {
    const current = stateRef.current;
    if (!current) return;
    if (normalTabCount >= activePlan.maxTabs)
      return showToast(
        `${activePlan.name} supports up to ${activePlan.maxTabs} tabs`,
      );
    await flushEditor();
    const next = clone(stateRef.current!);
    const tab = createPlainTab(`Tab ${normalTabCount + 1}`) as SaverTab;
    next.tabs.splice(next.tabs.findIndex(isInbox), 0, tab);
    next.activeTabId = tab.id;
    if (serializedStateBytes(next) > activePlan.maxStateBytes)
      return showToast(`${activePlan.name} storage limit reached`);
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
      title: "Rename tab",
      message: "Enter a new name for this tab.",
      confirmLabel: "Rename",
      input: { label: "Tab name", value: tab.name },
      validate: (name) => (name.trim() ? null : "Tab name cannot be empty."),
    });
    if (typeof value !== "string") return;
    const next = clone(stateRef.current!);
    const renamed = next.tabs.find((item) => item.id === tabId)!;
    renamed.name = value.trim();
    stateRef.current = next;
    setState(next);
    if (isEncryptedTab(renamed) && unlockedKeys.current.has(tabId))
      await touchUnlock(renamed);
    await persist(next);
  }

  async function deleteTab(tabId: string) {
    const current = stateRef.current;
    const tab = current?.tabs.find((item) => item.id === tabId);
    if (!current || !tab || isInbox(tab) || normalTabCount === 1) return;
    await flushEditor();
    if (isEncryptedTab(tab) || tab.text) {
      const confirmed = await ask({
        title: "Delete tab?",
        message: `“${tab.name}” contains saved text. This action cannot be undone.`,
        confirmLabel: "Delete",
      });
      if (!confirmed) return;
    }
    const next = clone(stateRef.current!);
    const index = next.tabs.findIndex((item) => item.id === tabId);
    next.tabs.splice(index, 1);
    if (next.activeTabId === tabId)
      next.activeTabId = next.tabs[Math.min(index, next.tabs.length - 1)].id;
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
    if (password.length < MIN_PASSWORD_LENGTH)
      return "Password must contain at least 8 characters.";
    return password === confirmation ? null : "Passwords do not match.";
  }

  async function requestNewPassword(title: string, message: string) {
    return ask({
      title,
      message,
      confirmLabel: "Save password",
      input: {
        label: "Password",
        type: "password",
        autocomplete: "new-password",
      },
      inputTwo: {
        label: "Confirm password",
        type: "password",
        autocomplete: "new-password",
      },
      validate: passwordValidation,
    });
  }

  async function setPassword(tabId: string) {
    const current = stateRef.current;
    const original = current?.tabs.find((tab) => tab.id === tabId);
    if (!current || !original || isInbox(original) || isEncryptedTab(original))
      return;
    if (current.activeTabId === tabId) await flushEditor();
    const result = await requestNewPassword(
      "Protect tab",
      "Encrypt this tab with a password. Forgotten passwords cannot be recovered.",
    );
    if (!Array.isArray(result)) return;
    const next = clone(stateRef.current!);
    const tab = next.tabs.find((item) => item.id === tabId)!;
    if (isEncryptedTab(tab)) return;
    const plaintext = tab.text;
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKeyBytes(result[0], salt);
    const payload = await encryptText(plaintext, tab.id, key, salt);
    const encrypted = {
      id: tab.id,
      name: tab.name,
      kind: "normal" as const,
      protected: true as const,
      ...payload,
    };
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
    let plaintext = "";
    const result = await ask({
      title: "Unlock tab",
      message: `Enter the password for “${tab.name}”.`,
      confirmLabel: "Unlock",
      input: {
        label: "Password",
        type: "password",
        autocomplete: "current-password",
      },
      validate: async (password) => {
        try {
          key = await deriveKeyBytes(password, base64ToBytes(tab.salt));
          plaintext = await decryptText(tab, key);
          return null;
        } catch {
          return "Incorrect password or damaged encrypted data.";
        }
      },
    });
    if (result === null || !key) return false;
    unlockedKeys.current.set(tabId, key);
    unlockedText.current.set(tabId, plaintext);
    await touchUnlock(tab);
    if (stateRef.current?.activeTabId === tabId) {
      setLocked(false);
      setEditorText(plaintext);
      editorTextRef.current = plaintext;
    }
    return true;
  }

  async function verifyPassword(tab: SaverTab, title: string) {
    if (!isEncryptedTab(tab)) return null;
    let key: Uint8Array | undefined;
    let plaintext = "";
    const result = await ask({
      title,
      message: "Enter the current password to continue.",
      confirmLabel: "Continue",
      input: {
        label: "Current password",
        type: "password",
        autocomplete: "current-password",
      },
      validate: async (password) => {
        try {
          key = await deriveKeyBytes(password, base64ToBytes(tab.salt));
          plaintext = await decryptText(tab, key);
          return null;
        } catch {
          return "Incorrect password or damaged encrypted data.";
        }
      },
    });
    return result === null || !key ? null : { key, plaintext };
  }

  async function securityAction(tabId: string) {
    const tab = stateRef.current?.tabs.find((item) => item.id === tabId);
    if (!tab || isInbox(tab)) return;
    if (!isEncryptedTab(tab)) return setPassword(tabId);
    if (!unlockedKeys.current.has(tabId)) return unlockTab(tabId);
    const choice = await ask({
      title: "Password options",
      message: `Manage protection for “${tab.name}”.`,
      options: [
        { label: "Lock now", value: "lock" },
        { label: "Change password", value: "change" },
        { label: "Remove password", value: "remove" },
      ],
    });
    if (choice === "lock") return lockTab(tabId);
    if (choice !== "change" && choice !== "remove") return;
    await flushEditor();
    const latest = stateRef.current!.tabs.find((item) => item.id === tabId)!;
    const verified = await verifyPassword(
      latest,
      choice === "change" ? "Change password" : "Remove password",
    );
    if (!verified) return;
    const next = clone(stateRef.current!);
    const index = next.tabs.findIndex((item) => item.id === tabId);
    const existing = next.tabs[index];
    if (choice === "remove") {
      next.tabs[index] = {
        id: existing.id,
        name: existing.name,
        kind: "normal",
        protected: false,
        text: verified.plaintext,
      };
      await clearUnlockKey(tabId);
      unlockedKeys.current.delete(tabId);
      unlockedText.current.delete(tabId);
      clearTimeout(lockTimers.current.get(tabId));
      lockTimers.current.delete(tabId);
    } else {
      const passwords = await requestNewPassword(
        "Choose a new password",
        "The tab will be re-encrypted immediately.",
      );
      if (!Array.isArray(passwords) || !isEncryptedTab(existing)) return;
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const key = await deriveKeyBytes(passwords[0], salt);
      Object.assign(
        existing,
        await encryptText(
          verified.plaintext,
          existing.id,
          key,
          salt,
          existing.encryptionContextId || existing.id,
        ),
      );
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
    const confirmed = await ask({
      title: "Reset protected tab?",
      message: `The encrypted content in “${tab.name}” will be permanently deleted. The password cannot be recovered.`,
      confirmLabel: "Delete encrypted content",
    });
    if (!confirmed) return;
    const next = clone(current);
    const index = next.tabs.findIndex((item) => item.id === tabId);
    next.tabs[index] = {
      id: tab.id,
      name: tab.name,
      kind: "normal",
      protected: false,
      text: "",
    };
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
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const temporary = document.createElement("textarea");
      temporary.value = text;
      temporary.style.position = "fixed";
      temporary.style.opacity = "0";
      document.body.append(temporary);
      temporary.select();
      document.execCommand("copy");
      temporary.remove();
    }
    showToast(message);
    if (activeTab && isEncryptedTab(activeTab)) await touchUnlock(activeTab);
  }

  async function downloadText() {
    if (!activeTab || locked) return;
    const now = new Date();
    const filename = `Text Saver - ${now.toLocaleString("en-US", { month: "long" })} ${now.getDate()} ${now.getFullYear()}.txt`;
    const url = URL.createObjectURL(
      new Blob([editorText.replace(/\r?\n/g, "\r\n")], {
        type: "text/plain;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (isEncryptedTab(activeTab)) await touchUnlock(activeTab);
  }

  function navigateFind(direction: number) {
    if (!matches.length) return;
    const next =
      findIndex < 0
        ? direction < 0
          ? matches.length - 1
          : 0
        : (findIndex + direction + matches.length) % matches.length;
    setFindIndex(next);
    const match = matches[next];
    editorRef.current?.focus();
    editorRef.current?.setSelectionRange(match.start, match.end);
  }

  async function exportBackup() {
    await flushEditor();
    const backup = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      state: clone(stateRef.current),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `text-saver-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("Backup exported");
  }

  function backupTabSize(tab: SaverTab) {
    if (!isEncryptedTab(tab))
      return `${tab.text.length.toLocaleString()} characters`;
    const padding = tab.ciphertext.endsWith("==")
      ? 2
      : tab.ciphertext.endsWith("=")
        ? 1
        : 0;
    return `${formatByteSize(Math.max(0, Math.floor((tab.ciphertext.length * 3) / 4) - padding))} encrypted`;
  }

  async function importBackup(file?: File) {
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES) return showToast("Backup is too large");
    let backup: { format: string; version: number; state: SaverState };
    try {
      backup = JSON.parse(await file.text());
    } catch {
      return showToast("Could not read this backup");
    }
    if (
      backup?.format !== BACKUP_FORMAT ||
      backup.version !== BACKUP_VERSION ||
      !isValidState(backup.state)
    )
      return showToast("Invalid or unsupported backup");
    const current = stateRef.current!;
    const importedTabs = backup.state.tabs.filter((tab) => !isInbox(tab));
    const existingIds = new Set(current.tabs.map((tab) => tab.id));
    const availableSlots = Math.max(0, activePlan.maxTabs - normalTabCount);
    let ready = 0;
    const preview = backup.state.tabs.map((tab) => {
      let status = "Ready",
        conflict = false;
      if (isInbox(tab)) status = "Replace only";
      else if (existingIds.has(tab.id)) {
        status = "Already exists";
        conflict = true;
      } else if (ready >= availableSlots) {
        status = "Tab limit";
        conflict = true;
      } else ready += 1;
      return {
        name: tab.name,
        protected: isEncryptedTab(tab),
        size: backupTabSize(tab),
        status,
        conflict,
      };
    });
    const choice = await ask({
      title: "Import backup",
      message: `Review ${importedTabs.length} saved ${importedTabs.length === 1 ? "tab" : "tabs"} before choosing how to import them.`,
      preview,
      options: [
        {
          label: `Merge ${ready} available ${ready === 1 ? "tab" : "tabs"}`,
          value: "merge",
          disabled: ready === 0,
        },
        { label: "Replace current tabs", value: "replace" },
      ],
    });
    if (!choice) return;
    await flushEditor();
    let next: SaverState;
    let importedCount = importedTabs.length;
    if (choice === "replace") next = clone(backup.state);
    else {
      const additions = importedTabs
        .filter((tab) => !existingIds.has(tab.id))
        .slice(0, availableSlots)
        .map(clone);
      importedCount = additions.length;
      if (!importedCount)
        return showToast(
          availableSlots
            ? "These tabs are already imported"
            : "Tab limit reached",
        );
      next = clone(stateRef.current!);
      next.tabs.splice(next.tabs.findIndex(isInbox), 0, ...additions);
      if (serializedStateBytes(next) > activePlan.maxStateBytes)
        return showToast(`${activePlan.name} storage limit reached`);
    }
    const ids = new Set(
      [...stateRef.current!.tabs, ...next.tabs].map((tab) => tab.id),
    );
    await clearUnlocks(ids);
    stateRef.current = next;
    setState(next);
    await persist(next);
    await displayState(next);
    showToast(
      choice === "replace"
        ? serializedStateBytes(next) > activePlan.maxStateBytes
          ? "Backup restored read-only until usage is within plan limits"
          : "Backup restored"
        : `${importedCount} ${importedCount === 1 ? "tab" : "tabs"} imported`,
    );
  }

  async function openPlans() {
    await flushEditor();
    setLicenseError("");
    setPlanOpen(true);
    await refreshPlan();
  }

  async function handleActivation() {
    const key = licenseInput.trim();
    if (!key)
      return setLicenseError("Enter the license key from your Creem receipt.");
    setPlanBusy(true);
    setLicenseError("");
    const oldLicense = (await getStoredLicense()) as License | null;
    // Keep the customer key only long enough to send the one activation call.
    setLicenseInput("");
    try {
      const nextLicense = (await activateLicense(key, deviceName)) as License;
      if (oldLicense) {
        await disableCloudSync();
      }
      await refreshPlan();
      showToast(`${currentPlan(nextLicense).name} activated`);
    } catch (error) {
      const typed = error as InstanceType<typeof LicenseApiError>;
      setLicenseError(
        error instanceof LicenseApiError
          ? typed.message
          : "Activation failed. Try again.",
      );
      if (
        error instanceof LicenseApiError &&
        [
          "DEVICE_LIMIT_REACHED",
          "DEVICE_LIMIT_EXCEEDED",
          "LICENSE_DEVICE_LIMIT_EXCEEDED",
        ].includes(typed.code)
      ) {
        setDevicesOpen(true);
        try {
          const result = (await listDevices()) as {
            devices: LicenseDevice[];
            maxDevices: number;
          };
          setDevices(result.devices);
          setDeviceLimit(result.maxDevices);
        } catch {
          setDevices([]);
        }
      }
    } finally {
      setPlanBusy(false);
    }
  }

  async function handleValidation() {
    setPlanBusy(true);
    setLicenseError("");
    try {
      const checked = (await validateLicense({
        force: true,
      })) as License | null;
      await refreshPlan();
      if (checked?.status === "active") showToast("License validated");
      else if (checked?.status === "offline_grace")
        showToast("Server unavailable · offline grace remains active");
      else
        setLicenseError(
          "The license could not be validated. Check your connection and try again.",
        );
    } catch (error) {
      setLicenseError((error as Error).message);
      await refreshPlan();
    } finally {
      setPlanBusy(false);
    }
  }

  async function deactivateCurrent() {
    if (!license) return;
    const confirmed = await ask({
      title: "Sign out this device?",
      message:
        "This frees its license slot. Local notes remain available on the Free plan.",
      confirmLabel: "Sign out",
    });
    if (!confirmed) return;
    setPlanBusy(true);
    try {
      await deactivateInstallation(license);
      await disableCloudSync();
      setDevices([]);
      setDevicesOpen(false);
      await refreshPlan();
      showToast("Signed out");
    } catch (error) {
      setLicenseError((error as Error).message);
    } finally {
      setPlanBusy(false);
    }
  }

  async function refreshDevices() {
    setPlanBusy(true);
    setLicenseError("");
    setDevicesOpen(true);
    try {
      const result = (await listDevices()) as {
        devices: LicenseDevice[];
        maxDevices: number;
      };
      setDevices(result.devices);
      setDeviceLimit(result.maxDevices);
    } catch (error) {
      setLicenseError((error as Error).message);
    } finally {
      setPlanBusy(false);
    }
  }

  async function deactivateDevice(id: string) {
    const target = devices.find((device) => device.id === id);
    if (!target || target.isCurrent) return;
    const confirmed = await ask({
      title: "Deactivate this device?",
      message: `${target.deviceName || "This device"} can be activated again later.`,
      confirmLabel: "Deactivate",
    });
    if (!confirmed) return;
    setPlanBusy(true);
    try {
      await deactivateLicenseDevice(id);
      const result = (await listDevices()) as {
        devices: LicenseDevice[];
        maxDevices: number;
      };
      setDevices(result.devices);
      setDeviceLimit(result.maxDevices);
      showToast("Device deactivated");
    } catch (error) {
      setLicenseError((error as Error).message);
      if (error instanceof LicenseApiError && error.code === "NOT_FOUND") {
        try {
          const result = (await listDevices()) as {
            devices: LicenseDevice[];
            maxDevices: number;
          };
          setDevices(result.devices);
          setDeviceLimit(result.maxDevices);
        } catch {
          // Keep the original, more useful not-found message.
        }
      }
    } finally {
      setPlanBusy(false);
    }
  }

  async function revokeDevice(id: string) {
    const target = devices.find((device) => device.id === id);
    if (!target || target.isCurrent) return;
    const confirmed = await ask({
      title: "Permanently revoke this device?",
      message: `${target.deviceName || "This installation"} will never be able to activate this license again.`,
      confirmLabel: "Revoke permanently",
    });
    if (!confirmed) return;
    setPlanBusy(true);
    try {
      await revokeLicenseDevice(id);
      const result = (await listDevices()) as {
        devices: LicenseDevice[];
        maxDevices: number;
      };
      setDevices(result.devices);
      setDeviceLimit(result.maxDevices);
      showToast("Device revoked");
    } catch (error) {
      setLicenseError((error as Error).message);
      if (error instanceof LicenseApiError && error.code === "NOT_FOUND") {
        try {
          const result = (await listDevices()) as {
            devices: LicenseDevice[];
            maxDevices: number;
          };
          setDevices(result.devices);
          setDeviceLimit(result.maxDevices);
        } catch {
          // Keep the original, more useful not-found message.
        }
      }
    } finally {
      setPlanBusy(false);
    }
  }

  async function requestSyncPassword(title: string) {
    return ask({
      title,
      message:
        "Use the same password on both devices. Text Saver cannot recover it.",
      confirmLabel: "Continue",
      input: {
        label: "Sync password",
        type: "password",
        autocomplete: "new-password",
      },
      inputTwo: {
        label: "Confirm sync password",
        type: "password",
        autocomplete: "new-password",
      },
      validate: (password, confirmation) =>
        password.length < 12
          ? "Use at least 12 characters."
          : password === confirmation
            ? null
            : "Passwords do not match.",
    });
  }

  async function setupSync(reset = false) {
    const result = await requestSyncPassword(
      reset ? "Reset encrypted cloud copy" : "Set up encrypted sync",
    );
    if (!Array.isArray(result)) return;
    setPlanBusy(true);
    setLicenseError("");
    try {
      await flushEditor();
      const synced = (
        reset
          ? await resetCloudSync(result[0])
          : await enableCloudSync(result[0])
      ) as SaverState;
      await applyIncomingState(synced);
      await refreshPlan();
      showToast(reset ? "Cloud copy reset" : "Cloud sync enabled");
    } catch (error) {
      setLicenseError((error as Error).message);
    } finally {
      setPlanBusy(false);
    }
  }

  function offlineSyncMessage() {
    return "Offline or server unavailable · changes are safe locally and will retry.";
  }

  function isRetryableSyncError(error: unknown) {
    return (
      !navigator.onLine ||
      (error instanceof LicenseApiError && error.isTemporary)
    );
  }

  function queueCloudSync(delay = AUTO_SYNC_DELAY) {
    cloudSyncPending.current = true;
    clearTimeout(cloudSyncTimer.current);
    cloudSyncTimer.current = setTimeout(() => {
      cloudSyncTimer.current = undefined;
      void runCloudSync(false);
    }, delay);
  }

  async function runCloudSync(notify: boolean) {
    clearTimeout(cloudSyncTimer.current);
    cloudSyncTimer.current = undefined;
    cloudSyncPending.current = true;

    try {
      await flushEditor();
    } catch {
      const message =
        "Local save failed · cloud sync postponed to protect this edit";
      setLicenseError(message);
      if (notify) showToast(message);
      return;
    }

    if (!navigator.onLine) {
      await deferCloudSync(offlineSyncMessage());
      await refreshPlan();
      if (notify)
        showToast(
          "You’re offline · changes are saved locally and queued for sync",
        );
      return;
    }

    if (cloudSyncInFlight.current) {
      return;
    }

    setPlanBusy(true);
    setLicenseError("");
    cloudSyncPending.current = false;
    const beforeSync = clone(stateRef.current!);
    const request = (async () => {
      const synced = (await synchronizeNow()) as SaverState | null;
      if (synced) {
        await flushEditor();
        const latest = stateRef.current!;
        const reconciled =
          JSON.stringify(latest) === JSON.stringify(beforeSync)
            ? synced
            : (mergeStates(beforeSync, latest, synced) as SaverState);
        await persist(reconciled);
        await applyIncomingState(reconciled);
      }
      await refreshPlan();
    })();
    cloudSyncInFlight.current = request;
    let succeeded = false;
    try {
      await request;
      succeeded = true;
      if (notify) showToast("Cloud sync complete");
    } catch (error) {
      const message = (error as Error).message;
      setLicenseError(message);
      if (isRetryableSyncError(error)) {
        cloudSyncPending.current = true;
        const retryAfterMs =
          error instanceof LicenseApiError &&
          typeof error.details?.retryAfterMs === "number"
            ? error.details.retryAfterMs
            : undefined;
        await deferCloudSync(offlineSyncMessage(), retryAfterMs);
        if (notify)
          showToast(
            "Could not reach the cloud · changes are saved locally and will retry",
          );
      } else if (notify) {
        showToast(message);
      }
      await refreshPlan();
    } finally {
      cloudSyncInFlight.current = null;
      setPlanBusy(false);
      if (succeeded && cloudSyncPending.current && navigator.onLine)
        queueCloudSync();
    }
  }

  async function syncNow() {
    await runCloudSync(true);
  }

  useEffect(() => {
    function retryPendingSync() {
      if (
        syncSettings?.enabled &&
        (cloudSyncPending.current || syncSettings.status === "pending")
      ) {
        queueCloudSync(0);
      }
    }
    window.addEventListener("online", retryPendingSync);
    return () => window.removeEventListener("online", retryPendingSync);
  }, [syncSettings?.enabled, syncSettings?.status]);

  async function turnOffSync() {
    const confirmed = await ask({
      title: "Turn off cloud sync?",
      message: "Your local notes and encrypted cloud copy remain available.",
      confirmLabel: "Turn off",
    });
    if (!confirmed) return;
    setPlanBusy(true);
    try {
      await disableCloudSync();
      clearTimeout(cloudSyncTimer.current);
      cloudSyncPending.current = false;
      await refreshPlan();
      showToast("Cloud sync turned off");
    } catch (error) {
      setLicenseError((error as Error).message);
    } finally {
      setPlanBusy(false);
    }
  }

  async function toggleTabSync(tabId: string) {
    const tab = stateRef.current?.tabs.find((item) => item.id === tabId);
    if (!tab || isInbox(tab)) return;
    if (planId !== "plus") {
      setPlanOpen(true);
      showToast("Cloud sync requires Plus");
      return;
    }
    if (!syncSettings?.enabled) {
      setPlanOpen(true);
      showToast("Set up cloud sync first");
      return;
    }

    const selected = [...syncedTabIds];
    const isSelected = syncedTabIds.has(tabId);
    if (!isSelected && selected.length >= activePlan.maxSyncedTabs) {
      showToast(`Plus supports up to ${activePlan.maxSyncedTabs} synced tabs`);
      return;
    }
    const nextIds = isSelected
      ? selected.filter((id) => id !== tabId)
      : [...selected, tabId];
    setPlanBusy(true);
    setLicenseError("");
    try {
      await flushEditor();
      const synced = (await setSyncedTabIds(nextIds)) as SaverState | null;
      if (synced) await applyIncomingState(synced);
      await refreshPlan();
      showToast(
        isSelected ? "Tab is now local only" : "Tab added to cloud sync",
      );
    } catch (error) {
      const message = (error as Error).message;
      setLicenseError(message);
      showToast(message);
      await refreshPlan();
    } finally {
      setPlanBusy(false);
    }
  }

  async function reorderTabs(list: SaverTab[]) {
    const current = stateRef.current;
    if (
      !current ||
      list.length !== current.tabs.length ||
      list.every((tab, index) => tab.id === current.tabs[index].id)
    )
      return;
    await flushEditor();
    const byId = new Map(stateRef.current!.tabs.map((tab) => [tab.id, tab]));
    const next = {
      ...stateRef.current!,
      tabs: list.map((tab) => clone(byId.get(tab.id)!)),
    };
    stateRef.current = next;
    setState(next);
    await persist(next);
  }

  return (
    <TextSaverContext.Provider
      value={{
        state,
        activeTab,
        normalTabCount,
        syncedTabIds,
        editor: {
          text: editorText,
          ref: editorRef,
          gutterRef,
          lineHeights,
          locked,
          stats,
          findOpen,
          findQuery,
          findIndex,
          matches,
        },
        plan: {
          active: activePlan,
          open: planOpen,
          license,
          licenseInput,
          deviceName,
          licenseError,
          busy: planBusy,
          syncSettings,
          devices,
          deviceLimit,
          devicesOpen,
        },
        ui: { theme, saveStatus, contextMenu, promptConfig, toast },
        actions: {
          toggleTheme,
          openFind: () =>
            locked ? showToast("Unlock this tab to search") : setFindOpen(true),
          closeFind: () => setFindOpen(false),
          changeFindQuery: (query) => {
            setFindQuery(query);
            setFindIndex(-1);
          },
          navigateFind,
          switchTab,
          reorderTabs,
          addTab,
          renameTab,
          deleteTab,
          securityAction,
          lockTab,
          unlockTab,
          resetProtectedTab,
          copyText,
          downloadText,
          changeEditorText: handleEditorChange,
          openPlans,
          closePlans: () => setPlanOpen(false),
          setLicenseInput,
          setDeviceName,
          activateLicense: handleActivation,
          validateLicense: handleValidation,
          deactivateCurrent,
          refreshDevices,
          deactivateDevice,
          revokeDevice,
          setupSync,
          syncNow,
          turnOffSync,
          toggleTabSync,
          openContextMenu: setContextMenu,
          closeContextMenu: () => setContextMenu(null),
          openGuide: startGuide,
          exportBackup,
          importBackup,
          resolvePrompt,
          isUnlocked: (tabId) => unlockedKeys.current.has(tabId),
        },
      }}
    >
      {children}
    </TextSaverContext.Provider>
  );
}
