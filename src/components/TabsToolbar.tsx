import { Button } from '@/components/ui/button';
import { useTextSaver } from '@/context/TextSaverContext';
import { isEncryptedTab, isInbox } from '@/lib/app-utils';
import { cn } from '@/lib/utils';
import type { SaverState, SaverTab } from '@/types';
import { Cloud, Inbox, Lock, Plus, Unlock } from 'lucide-react';
import type { MouseEvent } from 'react';
import { ReactSortable } from 'react-sortablejs';

type Props = {
  state: SaverState;
  maxTabs: number;
  normalTabCount: number;
  syncedTabIds: ReadonlySet<string>;
  isUnlocked: (tabId: string) => boolean;
  onSwitch: (tabId: string) => void;
  onReorder: (tabs: SaverTab[]) => void;
  onOpenContextMenu: (tabId: string, x: number, y: number) => void;
  onAdd: () => void;
};

type TabItemProps = {
  tab: SaverTab;
  active: boolean;
  synced: boolean;
  unlocked: boolean;
  onSwitch: (tabId: string) => void;
  onOpenContextMenu: (tabId: string, x: number, y: number) => void;
};

function TabItem(props: TabItemProps) {
  const handleContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    props.onOpenContextMenu(props.tab.id, event.clientX, event.clientY);
  };

  return (
    <div
      data-id={props.tab.id}
      className={cn(
        'group flex h-9 max-w-44 shrink-0 cursor-grab items-center rounded-md border bg-card text-muted-foreground transition-colors',
        props.active && 'border-primary/15 bg-accent text-foreground',
        // isInbox(props.tab) && 'border-amber-500/40',
      )}
      onContextMenu={handleContextMenu}
    >
      <button
        className="flex min-w-0 items-center gap-2 px-3.5 py-1.5 text-[13px]"
        title={props.tab.name}
        onClick={() => props.onSwitch(props.tab.id)}
      >
        {isInbox(props.tab) ? (
          <Inbox className="size-3.5 shrink-0 text-amber-500" />
        ) : isEncryptedTab(props.tab) ? (
          props.unlocked ? (
            <Unlock className="size-3.5 shrink-0" />
          ) : (
            <Lock className="size-3.5 shrink-0" />
          )
        ) : null}
        <span className="truncate">{props.tab.name}</span>
        {props.synced && <Cloud className="size-3.5 shrink-0 text-sky-500" aria-label="Synced" />}
      </button>
    </div>
  );
}

function TabsToolbarView(props: Props) {
  return (
    <div className="tabs-toolbar mt-2.5 flex min-h-10 items-start gap-1.5" data-tour="tabs">
      <ReactSortable
        list={props.state.tabs.map((tab) => ({ ...tab })) as (SaverTab & { chosen?: boolean; selected?: boolean })[]}
        setList={props.onReorder}
        animation={160}
        delay={80}
        delayOnTouchOnly
        direction="horizontal"
        className="flex flex-1 gap-1.5 overflow-x-auto pb-1"
      >
        {props.state.tabs.map((tab) => (
          <TabItem
            key={tab.id}
            tab={tab}
            active={tab.id === props.state.activeTabId}
            synced={props.syncedTabIds.has(tab.id)}
            unlocked={props.isUnlocked(tab.id)}
            onSwitch={props.onSwitch}
            onOpenContextMenu={props.onOpenContextMenu}
          />
        ))}
      </ReactSortable>
      {props.normalTabCount < props.maxTabs && (
        <Button
          variant="outline"
          size="icon"
          className="size-9 shrink-0"
          title="Add tab"
          disabled={props.normalTabCount >= props.maxTabs}
          onClick={props.onAdd}
        >
          <Plus />
        </Button>
      )}
    </div>
  );
}

export function TabsToolbar() {
  const { state, normalTabCount, syncedTabIds, plan, actions } = useTextSaver();
  if (!state) return null;
  return (
    <TabsToolbarView
      state={state}
      maxTabs={plan.active.maxTabs}
      normalTabCount={normalTabCount}
      syncedTabIds={syncedTabIds}
      isUnlocked={actions.isUnlocked}
      onSwitch={(tabId) => void actions.switchTab(tabId)}
      onReorder={(tabs) => void actions.reorderTabs(tabs)}
      onOpenContextMenu={(tabId, x, y) => actions.openContextMenu({ tabId, x, y })}
      onAdd={() => void actions.addTab()}
    />
  );
}
