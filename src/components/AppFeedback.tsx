import { Cloud } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTextSaver } from '@/context/TextSaverContext';

export function LoadingScreen() {
  return <div className="grid h-[590px] w-[760px] place-items-center bg-background text-base text-muted-foreground"><Cloud className="size-6 animate-pulse" />Loading Text Saver…</div>;
}

function ToastMessageView({ message }: { message: string }) {
  return <div className={cn('pointer-events-none fixed bottom-20 left-1/2 z-[70] -translate-x-1/2 translate-y-2 rounded-lg border border-border bg-popover px-3.5 py-2.5 text-[13px] opacity-0 shadow-xl transition-all', message && 'translate-y-0 opacity-100')}>{message}</div>;
}

export function ToastMessage() {
  const { ui } = useTextSaver();
  return <ToastMessageView message={ui.toast} />;
}
