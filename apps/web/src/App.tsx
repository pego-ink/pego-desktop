import { EditorShell } from "@/components/EditorShell";
import { usePersistence } from "@/persistence/use-persistence";

export const App = () => {
  usePersistence();
  return <EditorShell />;
};
