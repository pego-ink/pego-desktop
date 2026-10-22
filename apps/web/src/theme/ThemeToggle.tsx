import { useEffect } from "react";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { Button } from "@pego/ui/components/button";
import { nextThemeMode, setThemeMode, useThemeStore, watchSystemTheme } from "./theme";

const LABELS = { light: "Light mode", dark: "Dark mode", system: "System theme" } as const;

/** Day / night switch: cycles light, dark and the system setting. */
export const ThemeToggle = () => {
  const mode = useThemeStore((s) => s.mode);
  useEffect(() => watchSystemTheme(), []);
  const next = nextThemeMode(mode);
  const Icon = mode === "light" ? SunIcon : mode === "dark" ? MoonIcon : MonitorIcon;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`${LABELS[mode]} (switch to ${LABELS[next].toLowerCase()})`}
      title={`${LABELS[mode]}: click for ${LABELS[next].toLowerCase()}`}
      onClick={() => setThemeMode(next)}
    >
      <Icon />
    </Button>
  );
};
