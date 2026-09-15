import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useTextSaver } from '@/context/TextSaverContext';
import type { SaverTab } from '@/types';
import { ArrowDown, ArrowUp, Copy, Lock, Unlock, X } from 'lucide-react';
import type { KeyboardEvent, RefObject } from 'react';

type Match = { start: number; end: number };

type Props = {
  activeTab: SaverTab;
  editorRef: RefObject<HTMLTextAreaElement | null>;
  gutterRef: RefObject<HTMLDivElement | null>;
  editorText: string;
  lineHeights: number[];
  locked: boolean;
  maxCharacters: number;
  findOpen: boolean;
  findQuery: string;
  findIndex: number;
  matches: Match[];
  onUnlock: (tabId: string) => void;
  onResetProtected: (tabId: string) => void;
  onCopyLine: (line: string, index: number) => void;
  onEditorChange: (text: string) => void;
  onFindQueryChange: (query: string) => void;
  onNavigateFind: (direction: number) => void;
  onCloseFind: () => void;
};

function LockedTabOverlay(props: Pick<Props, 'activeTab' | 'onUnlock' | 'onResetProtected'>) {
  return (
    <div className="absolute inset-0 z-10 grid place-items-center bg-card">
      <div className="text-center">
        <div className="mx-auto mb-3 grid size-12 place-items-center rounded-full border border-border bg-muted">
          <Lock className="size-5 text-muted-foreground" />
        </div>
        <h2 className="text-sm font-semibold">This tab is locked</h2>
        <div className="mt-3 flex gap-2">
          <Button size="sm" onClick={() => props.onUnlock(props.activeTab.id)}>
            <Unlock />
            Unlock
          </Button>
          <Button size="sm" variant="outline" onClick={() => props.onResetProtected(props.activeTab.id)}>
            Forgot password
          </Button>
        </div>
      </div>
    </div>
  );
}

function LineGutter(props: Pick<Props, 'gutterRef' | 'editorText' | 'lineHeights' | 'onCopyLine'>) {
  return (
    <div
      ref={props.gutterRef}
      className="line-gutter w-12 shrink-0 overflow-hidden border-r border-border bg-muted/25 py-2.5 text-right font-mono text-[12px] leading-5 text-muted-foreground/60"
    >
      {props.editorText.split('\n').map((line, index) => (
        <LineNumberItem
          key={index}
          line={line}
          index={index}
          height={props.lineHeights[index] || 20}
          onCopy={props.onCopyLine}
        />
      ))}
    </div>
  );
}

function LineNumberItem({
  line,
  index,
  height,
  onCopy,
}: {
  line: string;
  index: number;
  height: number;
  onCopy: (line: string, index: number) => void;
}) {
  return (
    <button
      style={{ height }}
      className="group/line flex w-full items-center justify-end px-2.5 pt-px hover:bg-accent hover:text-foreground"
      title={`Copy line ${index + 1}`}
      onClick={() => onCopy(line, index)}
    >
      <span className="group-hover/line:hidden">{index + 1}</span>
      <Copy className="hidden size-3 group-hover/line:block" />
    </button>
  );
}

function FindPanel(
  props: Pick<Props, 'findQuery' | 'findIndex' | 'matches' | 'onFindQueryChange' | 'onNavigateFind' | 'onCloseFind'>,
) {
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      props.onNavigateFind(event.shiftKey ? -1 : 1);
    }
    if (event.key === 'Escape') props.onCloseFind();
  }

  return (
    <div className="absolute right-2 top-2 flex items-center gap-1 rounded-lg border border-border bg-popover p-1 shadow-xl">
      <Input
        autoFocus
        className="h-8 w-40"
        type="search"
        placeholder="Find"
        value={props.findQuery}
        onChange={(event) => props.onFindQueryChange(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <span className="min-w-10 text-center text-[11px] text-muted-foreground">
        {props.matches.length ? `${Math.max(0, props.findIndex + 1)}/${props.matches.length}` : '0/0'}
      </span>
      <Button
        size="icon"
        variant="ghost"
        className="size-8"
        disabled={!props.matches.length}
        onClick={() => props.onNavigateFind(-1)}
      >
        <ArrowUp />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="size-8"
        disabled={!props.matches.length}
        onClick={() => props.onNavigateFind(1)}
      >
        <ArrowDown />
      </Button>
      <Button size="icon" variant="ghost" className="size-8" onClick={props.onCloseFind}>
        <X />
      </Button>
    </div>
  );
}

function EditorPanelView(props: Props) {
  function handleEditorKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!props.findOpen) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      props.onNavigateFind(event.shiftKey ? -1 : 1);
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      props.onCloseFind();
    }
  }

  return (
    <section
      className="relative mt-1 flex min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-card shadow-inner"
      data-tour="editor"
    >
      {props.locked && (
        <LockedTabOverlay
          activeTab={props.activeTab}
          onUnlock={props.onUnlock}
          onResetProtected={props.onResetProtected}
        />
      )}
      {!props.locked && (
        <LineGutter
          gutterRef={props.gutterRef}
          editorText={props.editorText}
          lineHeights={props.lineHeights}
          onCopyLine={props.onCopyLine}
        />
      )}
      <textarea
        ref={props.editorRef}
        value={props.editorText}
        disabled={props.locked}
        maxLength={Math.max(props.maxCharacters, props.editorText.length)}
        placeholder="Write something great today..."
        className="min-w-0 flex-1 resize-none bg-card px-3.5 py-2.5 font-sans text-[14px] leading-5 text-foreground outline-none placeholder:text-muted-foreground/60 disabled:opacity-0"
        onChange={(event) => props.onEditorChange(event.target.value)}
        onScroll={(event) => {
          if (props.gutterRef.current) props.gutterRef.current.scrollTop = event.currentTarget.scrollTop;
        }}
        onKeyDown={handleEditorKeyDown}
      />
      {props.findOpen && !props.locked && (
        <FindPanel
          findQuery={props.findQuery}
          findIndex={props.findIndex}
          matches={props.matches}
          onFindQueryChange={props.onFindQueryChange}
          onNavigateFind={props.onNavigateFind}
          onCloseFind={props.onCloseFind}
        />
      )}
    </section>
  );
}

export function EditorPanel() {
  const { activeTab, editor, plan, actions } = useTextSaver();
  if (!activeTab) return null;
  return (
    <EditorPanelView
      activeTab={activeTab}
      editorRef={editor.ref}
      gutterRef={editor.gutterRef}
      editorText={editor.text}
      lineHeights={editor.lineHeights}
      locked={editor.locked}
      maxCharacters={plan.active.maxCharactersPerTab}
      findOpen={editor.findOpen}
      findQuery={editor.findQuery}
      findIndex={editor.findIndex}
      matches={editor.matches}
      onUnlock={(tabId) => void actions.unlockTab(tabId)}
      onResetProtected={(tabId) => void actions.resetProtectedTab(tabId)}
      onCopyLine={(line, index) => void actions.copyText(line, `Line ${index + 1} copied to clipboard`)}
      onEditorChange={actions.changeEditorText}
      onFindQueryChange={actions.changeFindQuery}
      onNavigateFind={actions.navigateFind}
      onCloseFind={actions.closeFind}
    />
  );
}
