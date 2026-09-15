import { Clipboard, CloudUpload, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTextSaver } from '@/context/TextSaverContext';

type Props = {
  stats: { words: number; characters: number; lines: number };
  locked: boolean;
  syncEnabled: boolean;
  syncBusy: boolean;
  onSync: () => void;
  onDownload: () => void;
  onCopy: () => void;
};

function EditorFooterView({ stats, locked, syncEnabled, syncBusy, onSync, onDownload, onCopy }: Props) {
  return (
    <footer className="mt-2 flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2" data-tour="actions">
      <div className="flex gap-2.5 text-[12px] text-muted-foreground">
        <span>{stats.words.toLocaleString()} words</span><span>·</span>
        <span>{stats.characters.toLocaleString()} characters</span><span>·</span>
        <span>{stats.lines.toLocaleString()} lines</span>
      </div>
      <div className="flex gap-2">
        {syncEnabled && <Button size="sm" variant="outline" disabled={syncBusy} onClick={onSync}><CloudUpload />Sync to Cloud</Button>}
        <Button size="sm" variant="outline" disabled={locked} onClick={onDownload}><Download />Download</Button>
        <Button size="sm" disabled={locked} onClick={onCopy}><Clipboard />Copy</Button>
      </div>
    </footer>
  );
}

export function EditorFooter() {
  const { activeTab, syncedTabIds, editor, plan, actions } = useTextSaver();
  return (
    <EditorFooterView
      stats={editor.stats}
      locked={editor.locked}
      syncEnabled={Boolean(activeTab && syncedTabIds.has(activeTab.id))}
      syncBusy={plan.busy}
      onSync={() => void actions.syncNow()}
      onDownload={() => void actions.downloadText()}
      onCopy={() => void actions.copyText(editor.text, 'Copied to clipboard')}
    />
  );
}
