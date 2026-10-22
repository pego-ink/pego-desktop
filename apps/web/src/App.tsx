import { useBridgeConnection } from "@/agent/use-bridge-connection";
import { EditorShell } from "@/components/EditorShell";
import { useDocumentFonts } from "@/fonts/use-document-fonts";
import { usePersistence } from "@/persistence/use-persistence";

export const App = () => {
  usePersistence();
  useBridgeConnection();
  useDocumentFonts();
  return <EditorShell />;
};
