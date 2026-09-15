import { Cloud, CloudOff, Lock, Pencil, Trash2, Unlock } from "lucide-react";
import { isEncryptedTab, isInbox } from "@/lib/app-utils";
import { useTextSaver } from "@/context/TextSaverContext";
import type { SaverTab, TabContextPosition } from "@/types";

type Props = {
  position: TabContextPosition;
  tab: SaverTab;
  normalTabCount: number;
  unlocked: boolean;
  synced: boolean;
  onClose: () => void;
  onRename: (tabId: string) => void;
  onSecurity: (tabId: string) => void;
  onLock: (tabId: string) => void;
  onToggleSync: (tabId: string) => void;
  onDelete: (tabId: string) => void;
};

function TabContextMenuView(props: Props) {
  const run = (action: (tabId: string) => void) => {
    props.onClose();
    action(props.tab.id);
  };
  return (
    <div
      className="fixed z-50 w-44 rounded-lg border border-border bg-popover p-1.5 shadow-xl"
      style={{
        left: Math.min(props.position.x, 580),
        top: Math.min(props.position.y, 470),
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        disabled={isInbox(props.tab)}
        className="context-item"
        onClick={() => run(props.onRename)}
      >
        <Pencil />
        Rename
      </button>
      <button
        disabled={isInbox(props.tab)}
        className="context-item"
        onClick={() =>
          run(
            isEncryptedTab(props.tab) && props.unlocked
              ? props.onLock
              : props.onSecurity,
          )
        }
      >
        {isEncryptedTab(props.tab) && !props.unlocked ? <Unlock /> : <Lock />}
        {!isEncryptedTab(props.tab)
          ? "Set password"
          : props.unlocked
            ? "Lock now"
            : "Unlock"}
      </button>
      <button
        disabled={isInbox(props.tab)}
        className="context-item"
        onClick={() => run(props.onToggleSync)}
      >
        {props.synced ? <CloudOff /> : <Cloud />}
        {props.synced ? "Stop syncing" : "Sync this tab"}
      </button>
      <button
        disabled={isInbox(props.tab) || props.normalTabCount === 1}
        className="context-item text-destructive"
        onClick={() => run(props.onDelete)}
      >
        <Trash2 />
        Delete tab
      </button>
    </div>
  );
}

export function TabContextMenu() {
  const { state, normalTabCount, syncedTabIds, ui, actions } = useTextSaver();
  const position = ui.contextMenu;
  const tab = position
    ? state?.tabs.find((item) => item.id === position.tabId)
    : null;
  if (!position || !tab) return null;
  return (
    <TabContextMenuView
      position={position}
      tab={tab}
      normalTabCount={normalTabCount}
      unlocked={actions.isUnlocked(tab.id)}
      synced={syncedTabIds.has(tab.id)}
      onClose={actions.closeContextMenu}
      onRename={(tabId) => void actions.renameTab(tabId)}
      onSecurity={(tabId) => void actions.securityAction(tabId)}
      onLock={(tabId) => void actions.lockTab(tabId)}
      onToggleSync={(tabId) => void actions.toggleTabSync(tabId)}
      onDelete={(tabId) => void actions.deleteTab(tabId)}
    />
  );
}
