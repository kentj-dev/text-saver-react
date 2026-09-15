import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTextSaver } from '@/context/TextSaverContext';
import { isEncryptedTab, isInbox } from '@/lib/app-utils';
import { cn } from '@/lib/utils';
import type { SaverTab } from '@/types';
import {
  Cloud,
  Ellipsis,
  FileDown,
  FileUp,
  HelpCircle,
  KeyRound,
  Lock,
  Moon,
  Pencil,
  Search,
  Sun,
  Trash2,
  Unlock,
} from 'lucide-react';
import { useRef } from 'react';

type Props = {
  planName: string;
  isPlusPlan: boolean;
  saveStatus: 'idle' | 'saving' | 'error';
  theme: 'dark' | 'light';
  activeTab: SaverTab;
  locked: boolean;
  normalTabCount: number;
  onToggleTheme: () => void;
  onOpenFind: () => void;
  onSecurity: (tabId: string) => void;
  onRename: (tabId: string) => void;
  onDelete: (tabId: string) => void;
  onOpenPlans: () => void;
  onOpenGuide: () => void;
  onExportBackup: () => void;
  onImportBackup: (file?: File) => void;
};

function AppHeaderView(props: Props) {
  const backupInputRef = useRef<HTMLInputElement>(null);
  return (
    <header className="flex min-h-12 items-center justify-between border-b border-border pb-2.5">
      <div className="brand flex items-center gap-2.5" data-tour="welcome">
        <img src="/images/128.png" alt="Text Saver" className="size-8 rounded-md" />
        <div className="flex items-center gap-1">
          <div className="text-[17px] font-bold leading-tight">Text Saver</div>
          {props.isPlusPlan && <div className="text-amber-600 font-bold italic text-2xl">+</div>}
        </div>
      </div>
      <div className="flex items-center gap-0.5">
        <span
          className={cn('mr-1 text-[11px] text-muted-foreground', props.saveStatus === 'error' && 'text-destructive')}
        >
          {props.saveStatus === 'saving' ? 'Saving…' : props.saveStatus === 'error' ? 'Save failed' : ''}
        </span>
        <Button
          variant="ghost"
          size="icon"
          title={`Switch to ${props.theme === 'dark' ? 'light' : 'dark'} mode`}
          onClick={props.onToggleTheme}
        >
          {props.theme === 'dark' ? <Sun /> : <Moon />}
        </Button>
        <Button variant="ghost" size="icon" title="Find in tab" data-tour="find" onClick={props.onOpenFind}>
          <Search />
        </Button>
        {!isInbox(props.activeTab) && (
          <>
            <Button
              variant="ghost"
              size="icon"
              data-tour="security"
              title={
                isEncryptedTab(props.activeTab) ? (props.locked ? 'Unlock tab' : 'Password options') : 'Set password'
              }
              onClick={() => props.onSecurity(props.activeTab.id)}
            >
              {isEncryptedTab(props.activeTab) && props.locked ? <Unlock /> : <Lock />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title={`Rename ${props.activeTab.name}`}
              onClick={() => props.onRename(props.activeTab.id)}
            >
              <Pencil />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title={`Delete ${props.activeTab.name}`}
              disabled={props.normalTabCount === 1}
              onClick={() => props.onDelete(props.activeTab.id)}
            >
              <Trash2 />
            </Button>
          </>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="More options" data-tour="more">
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={props.onOpenPlans}>
              <Cloud />
              Plan &amp; cloud
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={props.onOpenGuide}>
              <HelpCircle />
              Guide
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={props.onExportBackup}>
              <FileUp />
              Export backup
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => backupInputRef.current?.click()}>
              <FileDown />
              Import backup
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a href="https://bit.ly/4xDbvkk" target="_blank" rel="noreferrer">
                <KeyRound />
                Developer
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <input
          ref={backupInputRef}
          hidden
          type="file"
          accept="application/json,.json"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            props.onImportBackup(file);
          }}
        />
      </div>
    </header>
  );
}

export function AppHeader() {
  const { activeTab, normalTabCount, editor, plan, ui, actions } = useTextSaver();
  if (!activeTab) return null;
  return (
    <AppHeaderView
      planName={plan.active.name}
      isPlusPlan={plan.active.id === 'plus'}
      saveStatus={ui.saveStatus}
      theme={ui.theme}
      activeTab={activeTab}
      locked={editor.locked}
      normalTabCount={normalTabCount}
      onToggleTheme={() => void actions.toggleTheme()}
      onOpenFind={actions.openFind}
      onSecurity={(tabId) => void actions.securityAction(tabId)}
      onRename={(tabId) => void actions.renameTab(tabId)}
      onDelete={(tabId) => void actions.deleteTab(tabId)}
      onOpenPlans={() => void actions.openPlans()}
      onOpenGuide={actions.openGuide}
      onExportBackup={() => void actions.exportBackup()}
      onImportBackup={(file) => void actions.importBackup(file)}
    />
  );
}
