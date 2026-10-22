import { useBridgeConnection } from "@/agent/use-bridge-connection";
import { EditorShell } from "@/components/EditorShell";
import { usePersistence } from "@/persistence/use-persistence";

export const App = () => {
  usePersistence();
  useBridgeConnection();
  return <EditorShell />;
};
