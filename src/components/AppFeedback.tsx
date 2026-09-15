import { useTextSaver } from '@/context/TextSaverContext';
import { cn } from '@/lib/utils';

export function LoadingScreen() {
  return (
    <main className="relative flex h-[590px] w-[760px] select-none items-center justify-center overflow-hidden bg-background text-foreground">
      <div className="loading-glow absolute left-1/2 top-1/2 size-72 -translate-x-1/2 -translate-y-1/2 rounded-full" />
      <div
        className="relative z-10 flex -translate-y-2 flex-col items-center text-center"
        role="status"
        aria-live="polite"
        aria-label="Loading Text Saver"
      >
        <div className="relative grid size-[76px] place-items-center">
          <div className="absolute inset-0 rounded-[22px] border border-primary/15 bg-primary/5 shadow-glow" />
          <img src="/images/128.png" alt="" className="relative size-12 rounded-xl shadow-lg" />
        </div>

        <h1 className="mt-5 text-[18px] font-semibold tracking-tight">Text Saver</h1>
        <p className="mt-1.5 text-[11px] text-muted-foreground">Restoring your tabs and preferences</p>

        <div className="mt-5 h-1 w-36 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div className="loading-progress h-full w-1/2 rounded-full bg-primary" />
        </div>
      </div>
    </main>
  );
}

function ToastMessageView({ message }: { message: string }) {
  return (
    <div
      className={cn(
        'pointer-events-none fixed bottom-20 left-1/2 z-[70] -translate-x-1/2 translate-y-2 rounded-lg border border-border bg-popover px-3.5 py-2.5 text-[13px] opacity-0 shadow-xl transition-all',
        message && 'translate-y-0 opacity-100',
      )}
    >
      {message}
    </div>
  );
}

export function ToastMessage() {
  const { ui } = useTextSaver();
  return <ToastMessageView message={ui.toast} />;
}
