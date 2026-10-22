import { useEffect } from "react";
import { useBridgeConnection } from "@/agent/use-bridge-connection";
import { EditorShell } from "@/components/EditorShell";
import { UpdateNotice } from "@/desktop/UpdateNotice";
import { startUpdateStatus } from "@/desktop/use-update-status";
import { useDocumentFonts } from "@/fonts/use-document-fonts";
import { SettingsModal } from "@/panels/settings/SettingsModal";
import { usePersistence } from "@/persistence/use-persistence";

export const App = () => {
  usePersistence();
  useBridgeConnection();
  useDocumentFonts();
  useEffect(startUpdateStatus, []);
  return (
    <>
      <EditorShell />
      <UpdateNotice />
      <SettingsModal />
    </>
  );
};
