import { AppLayout } from "@/components/AppLayout";
import { TextSaverProvider } from "@/context/TextSaverProvider";

export default function App() {
  return (
    <TextSaverProvider>
      <AppLayout />
    </TextSaverProvider>
  );
}
