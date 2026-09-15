import {
  ALARM_PREFIX,
  INBOX_ID,
  UNLOCK_PREFIX,
  getOrMigrateState,
  saveState,
} from "./lib/storage.js";
import {
  CLOUD_SYNC_ALARM,
  deferCloudSync,
  scheduleCloudSync,
  syncNow,
} from "./lib/cloud-sync.js";
import {
  LICENSE_KEY,
  LICENSING_MESSAGE,
  effectivePlanId,
  getInstallation,
  getStoredLicense,
  validateLicense,
} from "./lib/licensing.js";
import {
  handleLicensingMessage,
  runLicensingCommand,
} from "./auth/licensingService.ts";
import { getPlanLimits, serializedStateBytes } from "./lib/plans.js";

globalThis.__TEXT_SAVER_LICENSING_SERVICE__ = runLicensingCommand;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== LICENSING_MESSAGE) return undefined;
  void handleLicensingMessage(message).then(sendResponse);
  return true;
});

chrome.runtime.onInstalled.addListener(async () => {
  try {
    await getInstallation();
    await getOrMigrateState();
  } catch (error) {
    console.error("Text Saver could not migrate saved data.", error);
  }

  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: "text-saver-highlight-text",
    title: "Save selected text to Context Menu inbox",
    contexts: ["selection"],
  });

  const stored = await chrome.storage.local.get(LICENSE_KEY);
  if (stored[LICENSE_KEY]) {
    await chrome.alarms.create("text-saver-license-validation", {
      periodInMinutes: 12 * 60,
    });
  }
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== "text-saver-highlight-text") return;
  try {
    const state = await getOrMigrateState();
    const inbox = state.tabs.find((tab) => tab.id === INBOX_ID);
    if (!inbox) throw new Error("Context Menu inbox is missing.");
    const selectedText =
      typeof info.selectionText === "string" ? info.selectionText : "";
    const nextText = `${selectedText}\n\n${inbox.text}`;
    const plan = getPlanLimits(effectivePlanId(await getStoredLicense()));
    if (
      nextText.length > plan.maxCharactersPerTab ||
      nextText.split("\n").length > plan.maxLinesPerTab
    ) {
      throw new Error(`${plan.name} Context Menu inbox limit reached.`);
    }
    inbox.text = nextText;
    if (serializedStateBytes(state) > plan.maxStateBytes) {
      throw new Error(`${plan.name} storage limit reached.`);
    }
    await saveState(state);
  } catch (error) {
    console.error("Text Saver could not save selected text.", error);
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === CLOUD_SYNC_ALARM) {
    try {
      await syncNow();
    } catch (error) {
      console.warn("Text Saver background sync failed.", error.message);
      if (error?.isTemporary) {
        await deferCloudSync(
          "Offline or server unavailable · changes are safe locally and will retry.",
          typeof error.details?.retryAfterMs === "number"
            ? error.details.retryAfterMs
            : undefined,
        );
      }
    }
    return;
  }
  if (!alarm.name.startsWith(ALARM_PREFIX)) return;
  const tabId = alarm.name.slice(ALARM_PREFIX.length);
  await chrome.storage.session.remove(`${UNLOCK_PREFIX}${tabId}`);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.text_saver_state) return;
  scheduleCloudSync().catch((error) =>
    console.warn("Text Saver could not schedule cloud sync.", error.message),
  );
});

chrome.runtime.onStartup.addListener(async () => {
  try {
    const license = await validateLicense();
    if (license?.status === "active") await syncNow();
  } catch (error) {
    console.warn("Text Saver startup validation failed.", error.message);
    if (error?.isTemporary) {
      await deferCloudSync(
        "Offline or server unavailable · changes are safe locally and will retry.",
        typeof error.details?.retryAfterMs === "number"
          ? error.details.retryAfterMs
          : undefined,
      );
    }
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[LICENSE_KEY]) return;
  if (changes[LICENSE_KEY].newValue) {
    chrome.alarms.create("text-saver-license-validation", {
      periodInMinutes: 12 * 60,
    });
  } else {
    chrome.alarms.clear("text-saver-license-validation");
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "text-saver-license-validation") return;
  try {
    await validateLicense({ force: true });
  } catch (error) {
    console.warn(
      "Text Saver scheduled license validation failed.",
      error.message,
    );
    if (error?.isTemporary) {
      const retryDelay =
        typeof error.details?.retryAfterMs === "number"
          ? error.details.retryAfterMs
          : 15 * 60 * 1000;
      await chrome.alarms.create("text-saver-license-validation", {
        when: Date.now() + retryDelay,
        periodInMinutes: 12 * 60,
      });
    }
  }
});
