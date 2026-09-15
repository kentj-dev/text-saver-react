import { createContext, useContext, type RefObject } from "react";
import type {
  License,
  LicenseDevice,
  Plan,
  PromptConfig,
  SaverState,
  SaverTab,
  SyncSettings,
  TabContextPosition,
  TextMatch,
} from "@/types";
import type { PromptResult } from "@/hooks/use-prompt";

export type TextSaverContextValue = {
  state: SaverState | null;
  activeTab?: SaverTab;
  normalTabCount: number;
  syncedTabIds: ReadonlySet<string>;
  editor: {
    text: string;
    ref: RefObject<HTMLTextAreaElement | null>;
    gutterRef: RefObject<HTMLDivElement | null>;
    lineHeights: number[];
    locked: boolean;
    stats: { words: number; characters: number; lines: number };
    findOpen: boolean;
    findQuery: string;
    findIndex: number;
    matches: TextMatch[];
  };
  plan: {
    active: Plan;
    open: boolean;
    license: License | null;
    licenseInput: string;
    deviceName: string;
    licenseError: string;
    busy: boolean;
    syncSettings: SyncSettings | null;
    devices: LicenseDevice[];
    deviceLimit: number;
    devicesOpen: boolean;
  };
  ui: {
    theme: "dark" | "light";
    saveStatus: "idle" | "saving" | "error";
    contextMenu: TabContextPosition | null;
    promptConfig: PromptConfig | null;
    toast: string;
  };
  actions: {
    toggleTheme: () => Promise<void>;
    openFind: () => void;
    closeFind: () => void;
    changeFindQuery: (query: string) => void;
    navigateFind: (direction: number) => void;
    switchTab: (tabId: string) => Promise<void>;
    reorderTabs: (tabs: SaverTab[]) => Promise<void>;
    addTab: () => Promise<void>;
    renameTab: (tabId: string) => Promise<void>;
    deleteTab: (tabId: string) => Promise<void>;
    securityAction: (tabId: string) => Promise<unknown>;
    lockTab: (tabId: string) => Promise<void>;
    unlockTab: (tabId: string) => Promise<boolean>;
    resetProtectedTab: (tabId: string) => Promise<void>;
    copyText: (text: string, message: string) => Promise<void>;
    downloadText: () => Promise<void>;
    changeEditorText: (text: string) => void;
    openPlans: () => Promise<void>;
    closePlans: () => void;
    setLicenseInput: (value: string) => void;
    setDeviceName: (value: string) => void;
    activateLicense: () => Promise<void>;
    validateLicense: () => Promise<void>;
    deactivateCurrent: () => Promise<void>;
    refreshDevices: () => Promise<void>;
    deactivateDevice: (id: string) => Promise<void>;
    revokeDevice: (id: string) => Promise<void>;
    setupSync: (reset?: boolean) => Promise<void>;
    syncNow: () => Promise<void>;
    turnOffSync: () => Promise<void>;
    toggleTabSync: (tabId: string) => Promise<void>;
    openContextMenu: (position: TabContextPosition) => void;
    closeContextMenu: () => void;
    openGuide: () => void;
    exportBackup: () => Promise<void>;
    importBackup: (file?: File) => Promise<void>;
    resolvePrompt: (value: PromptResult) => void;
    isUnlocked: (tabId: string) => boolean;
  };
};

export const TextSaverContext = createContext<TextSaverContextValue | null>(
  null,
);

export function useTextSaver() {
  const value = useContext(TextSaverContext);
  if (!value)
    throw new Error("useTextSaver must be used inside TextSaverProvider.");
  return value;
}
