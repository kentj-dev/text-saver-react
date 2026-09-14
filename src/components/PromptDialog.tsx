import { useEffect, useState } from 'react';
import { AlertTriangle, FileLock2, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { PromptConfig, PromptOption, PromptPreview } from '@/types';
import { useTextSaver } from '@/context/TextSaverContext';

type Props = {
  config: PromptConfig | null;
  onResolve: (value: boolean | string | string[] | null) => void;
};

function PreviewItem({ item }: { item: PromptPreview }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-muted/50 px-2.5 py-2">
      <div className="flex min-w-0 items-center gap-2">
        {item.protected ? <FileLock2 className="size-4 shrink-0 text-amber-500" /> : <FileText className="size-4 shrink-0 text-muted-foreground" />}
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium">{item.name}</div>
          <div className="text-[11px] text-muted-foreground">{item.size}</div>
        </div>
      </div>
      <span className={item.conflict ? 'text-[11px] text-destructive' : 'text-[11px] text-muted-foreground'}>{item.status}</span>
    </div>
  );
}

function OptionItem({ option, onSelect }: { option: PromptOption; onSelect: (value: string) => void }) {
  return <Button variant="outline" className="justify-start" disabled={option.disabled} title={option.title} onClick={() => onSelect(option.value)}>{option.label}</Button>;
}

function PromptDialogView({ config, onResolve }: Props) {
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setFirst(config?.input?.value || '');
    setSecond(config?.inputTwo?.value || '');
    setError('');
    setBusy(false);
  }, [config]);

  async function submit() {
    if (!config) return;
    setBusy(true);
    try {
      const validationError = await config.validate?.(first, second);
      if (validationError) {
        setError(validationError);
        return;
      }
      onResolve(config.inputTwo ? [first, second] : config.input ? first : true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={Boolean(config)} onOpenChange={(open) => !open && onResolve(null)}>
      <DialogContent hideClose onKeyDown={(event) => {
        if (event.key === 'Enter' && !config?.options) {
          event.preventDefault();
          void submit();
        }
      }}>
        <DialogHeader>
          <DialogTitle>{config?.title}</DialogTitle>
          {config?.message && <DialogDescription>{config.message}</DialogDescription>}
        </DialogHeader>

        {config?.preview && (
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border bg-background/60 p-1.5">
            {config.preview.map((item, index) => (
              <PreviewItem key={`${item.name}-${index}`} item={item} />
            ))}
          </div>
        )}

        {config?.input && (
          <label className="grid gap-1.5 text-[13px] text-muted-foreground">
            {config.input.label}
            <Input autoFocus value={first} onChange={(event) => setFirst(event.target.value)} type={config.input.type || 'text'} autoComplete={config.input.autocomplete || 'off'} maxLength={120} />
          </label>
        )}
        {config?.inputTwo && (
          <label className="grid gap-1.5 text-[13px] text-muted-foreground">
            {config.inputTwo.label}
            <Input value={second} onChange={(event) => setSecond(event.target.value)} type={config.inputTwo.type || 'text'} autoComplete={config.inputTwo.autocomplete || 'off'} maxLength={120} />
          </label>
        )}
        {error && (
          <p className="flex items-center gap-1.5 text-[13px] text-destructive" role="alert">
            <AlertTriangle className="size-3.5" /> {error}
          </p>
        )}

        {config?.options ? (
          <div className="grid gap-2">
            {config.options.map((option) => (
              <OptionItem key={option.value} option={option} onSelect={onResolve} />
            ))}
            <Button variant="ghost" onClick={() => onResolve(null)}>Cancel</Button>
          </div>
        ) : (
          <DialogFooter>
            <Button variant="outline" onClick={() => onResolve(null)}>Cancel</Button>
            <Button disabled={busy} onClick={() => void submit()}>{busy ? 'Working…' : config?.confirmLabel || 'Confirm'}</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function PromptDialog() {
  const { ui, actions } = useTextSaver();
  return <PromptDialogView config={ui.promptConfig} onResolve={actions.resolvePrompt} />;
}
