import { LoadingScreen, ToastMessage } from '@/components/AppFeedback';
import { AppHeader } from '@/components/AppHeader';
import { EditorFooter } from '@/components/EditorFooter';
import { EditorPanel } from '@/components/EditorPanel';
import { PlanPanel } from '@/components/PlanPanel';
import { PromptDialog } from '@/components/PromptDialog';
import { TabContextMenu } from '@/components/TabContextMenu';
import { TabsToolbar } from '@/components/TabsToolbar';
import { useTextSaver } from '@/context/TextSaverContext';

export function AppLayout() {
  const { state, activeTab, actions } = useTextSaver();
  if (!state || !activeTab) return <LoadingScreen />;

  return (
    <main className="relative flex h-[590px] w-[760px] flex-col overflow-hidden bg-background p-4 text-foreground" onClick={actions.closeContextMenu}>
      <AppHeader />
      <TabsToolbar />
      <EditorPanel />
      <EditorFooter />
      <TabContextMenu />
      <PlanPanel />
      <PromptDialog />
      <ToastMessage />
    </main>
  );
}
