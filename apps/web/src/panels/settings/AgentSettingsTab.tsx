import { useEffect, useRef, useState } from "react";
import { CustomProvidersSection } from "@/panels/agent/custom-provider/CustomProvidersSection";
import { ApiKeySection } from "@/panels/settings/agent/ApiKeySection";
import { BridgeSection } from "@/panels/settings/agent/BridgeSection";
import { DefaultAgentSection } from "@/panels/settings/agent/DefaultAgentSection";
import { InstallSection } from "@/panels/settings/agent/InstallSection";
import { LocalAgentsSection } from "@/panels/settings/agent/LocalAgentsSection";

const FLASH_MS = 1600;

/** Deep-link ids that land on a different block ("add-provider" opens the add form). */
const SECTION_TARGET: Record<string, string> = { "add-provider": "custom-providers" };

/** "Agent & Models" tab of the settings modal. `section` scrolls to and highlights one block. */
export const AgentSettingsTab = ({ section }: { section?: string }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    if (!section) return;
    const target = SECTION_TARGET[section] ?? section;
    const frame = requestAnimationFrame(() => {
      const element = rootRef.current?.querySelector<HTMLElement>(`[data-section="${target}"]`);
      if (!element) return;
      element.scrollIntoView({ block: "start" });
      setFlash(target);
    });
    const timer = setTimeout(() => setFlash(null), FLASH_MS);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [section]);

  return (
    <div ref={rootRef} className="grid gap-4">
      <DefaultAgentSection flashing={flash === "default"} />
      <ApiKeySection flashing={flash === "api-key"} />
      <LocalAgentsSection flashing={flash === "local-agents"} />
      <CustomProvidersSection
        flashing={flash === "custom-providers"}
        startAdding={section === "add-provider"}
      />
      <InstallSection flashing={flash === "install"} />
      <BridgeSection flashing={flash === "bridge"} />
    </div>
  );
};
