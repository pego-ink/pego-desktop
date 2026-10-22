import { useEffect } from "react";
import { startSessionSync } from "@/agent/sessions/session-sync";
import { useBridgeConnection } from "@/agent/use-bridge-connection";
import { EditorShell } from "@/components/EditorShell";
import { UpdateNotice } from "@/desktop/UpdateNotice";
import { startUpdateStatus } from "@/desktop/use-update-status";
import { syncNativeTheme } from "@/desktop/native-theme";
import { useDocumentFonts } from "@/fonts/use-document-fonts";
import { SettingsModal } from "@/panels/settings/SettingsModal";
import { usePersistence } from "@/persistence/use-persistence";

export const App = () => {
  usePersistence();
  useBridgeConnection();
  useDocumentFonts();
  useEffect(startUpdateStatus, []);
  useEffect(startSessionSync, []);
  useEffect(() => syncNativeTheme(), []);
  return (
    <>
      <EditorShell />
      <UpdateNotice />
      <SettingsModal />
    </>
  );
};
