import { useState } from "react";
import {
  ArrowDownUpIcon,
  ArrowRightIcon,
  ChevronsRightIcon,
  MoveHorizontalIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@pego/ui/components/button";
import { NumberField } from "@pego/ui/components/number-field";
import { SegmentedControl } from "@pego/ui/components/segmented-control";
import { Switch } from "@pego/ui/components/switch";
import { setThemeMode, useThemeStore, type ThemeMode } from "@/theme/theme";
import { toggleAutoSave } from "@/persistence/autosave-actions";
import { isFileAutosaveSupported } from "@/persistence/file-autosave";
import { useAutosaveStore } from "@/persistence/use-autosave-store";
import {
  useSettingsStore,
  type EditorSettings,
  type ImageSearchSource,
} from "@/store/use-settings-store";
import {
  TOOLBAR_POSITION_LABELS,
  TOOLBAR_POSITIONS,
  type ToolbarPosition,
} from "@/components/toolbar-position";
import {
  INTERFACE_STYLE_LABELS,
  INTERFACE_STYLES,
  type InterfaceStyle,
} from "@/layout/interface-style";
import { desktopApi, type DesktopTitleBarMode } from "@/desktop/desktop-api";
import { SettingRow, SettingsSection } from "./SettingRow";

const WHEEL_OPTIONS = [
  { value: "pan", label: "Pan", title: "Mouse wheel scrolls the canvas" },
  { value: "zoom", label: "Zoom", title: "Mouse wheel zooms at the cursor" },
] as const satisfies readonly {
  value: EditorSettings["wheelBehavior"];
  label: string;
  title: string;
}[];

const THEME_OPTIONS = [
  { value: "system", label: "System", title: "Follow the operating system setting" },
  { value: "light", label: "Light", title: "Always use the light theme" },
  { value: "dark", label: "Dark", title: "Always use the dark theme" },
] as const satisfies readonly { value: ThemeMode; label: string; title: string }[];

const TOOLBAR_OPTIONS = TOOLBAR_POSITIONS.map((value) => ({
  value,
  label: TOOLBAR_POSITION_LABELS[value],
  title: `Tools at the ${value} of the canvas`,
})) satisfies { value: ToolbarPosition; label: string; title: string }[];

const INTERFACE_OPTIONS = INTERFACE_STYLES.map((value) => ({
  value,
  label: INTERFACE_STYLE_LABELS[value],
  title:
    value === "floating"
      ? "Panels float as cards over the canvas, like pen.dev"
      : "Panels sit flush with the window edges",
})) satisfies { value: InterfaceStyle; label: string; title: string }[];

const NUDGE_LIMITS = { min: 0.1, max: 1000 } as const;

const NudgeField = ({
  caption,
  title,
  value,
  onChange,
}: {
  caption: string;
  title: string;
  value: number;
  onChange: (value: number) => void;
}) => (
  <div className="flex flex-col gap-1">
    <span className="text-[11px] text-muted-foreground">{caption}</span>
    <NumberField
      label={caption === "Arrow" ? <ArrowRightIcon /> : <ChevronsRightIcon />}
      labelTitle={title}
      value={value}
      {...NUDGE_LIMITS}
      suffix=" px"
      className="w-24"
      onChange={(next) => onChange(next)}
    />
  </div>
);

const TITLE_BAR_OPTIONS = [
  {
    value: "pego",
    label: "Pego",
    title: "One row: window buttons beside your tabs, menu under ☰",
  },
  { value: "system", label: "System", title: "Your desktop's own title bar and menu bar" },
] satisfies { value: DesktopTitleBarMode; label: string; title: string }[];

/** Linux / Windows desktop app: which title bar the next start uses. */
const TitleBarSetting = () => {
  const titleBar = desktopApi()?.titleBar;
  const [mode, setMode] = useState<DesktopTitleBarMode>(titleBar?.mode ?? "pego");
  if (!titleBar) return null;
  const choose = (next: DesktopTitleBarMode) => {
    setMode(next);
    void titleBar.setMode(next).then(
      (saved) =>
        saved
          ? toast(
              next === titleBar.mode
                ? "Title bar is back as it is now"
                : "Restart Pego to use the new title bar",
            )
          : toast.error("Could not save the title bar setting"),
      () => toast.error("Could not save the title bar setting"),
    );
  };
  return (
    <SettingRow
      title="Title bar"
      description="Pego keeps one row: window buttons beside your tabs, menu under ☰. System uses your desktop's own title bar. Applies after a restart."
    >
      {() => (
        <SegmentedControl
          aria-label="Title bar"
          value={mode}
          options={TITLE_BAR_OPTIONS}
          onChange={choose}
          className="w-56"
        />
      )}
    </SettingRow>
  );
};

const IMAGE_SEARCH_OPTIONS = [
  { value: "browser", label: "Google", title: "Google Images in Pego's built-in browser" },
  { value: "openverse", label: "Free photos", title: "Openly licensed photos from Openverse" },
] satisfies { value: ImageSearchSource; label: string; title: string }[];

/** Desktop app: where photo searches look (the Images panel and the agent). */
const ImageSearchSetting = () => {
  const imageSearch = useSettingsStore((s) => s.imageSearch);
  const update = useSettingsStore((s) => s.update);
  if (!desktopApi()?.browser) return null;
  return (
    <SettingsSection title="Images">
      <SettingRow
        title="Image search"
        description="Where the Images panel and the agent look for photos. Google searches in Pego's built-in browser (pictures are usually copyrighted); free photos come from Openverse with their license."
      >
        {() => (
          <SegmentedControl
            aria-label="Image search"
            value={imageSearch}
            options={IMAGE_SEARCH_OPTIONS}
            onChange={(next) => update({ imageSearch: next })}
            className="w-56"
          />
        )}
      </SettingRow>
    </SettingsSection>
  );
};

export const GeneralSettingsTab = () => {
  const autosaveEnabled = useAutosaveStore((s) => s.enabled);
  const supported = isFileAutosaveSupported();
  const nudgeSmall = useSettingsStore((s) => s.nudgeSmall);
  const nudgeLarge = useSettingsStore((s) => s.nudgeLarge);
  const wheelBehavior = useSettingsStore((s) => s.wheelBehavior);
  const snapToPixel = useSettingsStore((s) => s.snapToPixel);
  const toolbarPosition = useSettingsStore((s) => s.toolbarPosition);
  const interfaceStyle = useSettingsStore((s) => s.interfaceStyle);
  const themeMode = useThemeStore((s) => s.mode);
  const update = useSettingsStore((s) => s.update);
  const reset = useSettingsStore((s) => s.reset);

  return (
    <div>
      <SettingsSection title="Appearance">
        <SettingRow title="Theme" description="Choose light or dark, or follow your system.">
          {() => (
            <SegmentedControl
              aria-label="Theme"
              value={themeMode}
              options={THEME_OPTIONS}
              onChange={setThemeMode}
              className="w-56"
            />
          )}
        </SettingRow>
        <SettingRow
          title="Interface"
          description="Docked panels sit flush with the window. Floating panels are cards over the canvas."
        >
          {() => (
            <SegmentedControl
              aria-label="Interface"
              value={interfaceStyle}
              options={INTERFACE_OPTIONS}
              onChange={(next) => update({ interfaceStyle: next })}
              className="w-56"
            />
          )}
        </SettingRow>
        <SettingRow
          title="Toolbar position"
          description="Where the tools (Move, Hand, shapes, pen, text) float on the canvas. Right-click the toolbar to move it too."
        >
          {() => (
            <SegmentedControl
              aria-label="Toolbar position"
              value={toolbarPosition}
              options={TOOLBAR_OPTIONS}
              onChange={(next) => update({ toolbarPosition: next })}
              className="w-56"
            />
          )}
        </SettingRow>
        <TitleBarSetting />
      </SettingsSection>

      <ImageSearchSetting />

      <SettingsSection title="Saving">
        <SettingRow
          title="Auto save"
          description={
            supported
              ? "Write changes to the open file as you work."
              : "Saving to a file needs a Chromium browser. Changes are still kept in this browser."
          }
        >
          {({ labelId, descriptionId }) => (
            <Switch
              aria-labelledby={labelId}
              aria-describedby={descriptionId}
              checked={supported && autosaveEnabled}
              disabled={!supported}
              onCheckedChange={toggleAutoSave}
            />
          )}
        </SettingRow>
      </SettingsSection>

      <SettingsSection title="Editor">
        <SettingRow title="Nudge step" description="Arrow keys move the selection by this many px.">
          {({ labelId }) => (
            <div role="group" aria-labelledby={labelId} className="flex items-start gap-2">
              <NudgeField
                caption="Arrow"
                title="Arrow key"
                value={nudgeSmall}
                onChange={(value) => update({ nudgeSmall: value })}
              />
              <NudgeField
                caption="Shift + arrow"
                title="Shift + arrow key"
                value={nudgeLarge}
                onChange={(value) => update({ nudgeLarge: value })}
              />
            </div>
          )}
        </SettingRow>
        <SettingRow
          title="Mouse wheel"
          description={
            wheelBehavior === "zoom"
              ? "Scroll to zoom at the cursor. Hold Shift to pan sideways."
              : "Scroll to pan the canvas. Hold Ctrl or Cmd to zoom."
          }
        >
          {() => (
            <SegmentedControl
              aria-label="Mouse wheel"
              value={wheelBehavior}
              options={WHEEL_OPTIONS.map((option) => ({
                ...option,
                label: (
                  <span className="flex items-center gap-1.5">
                    {option.value === "pan" ? <ArrowDownUpIcon /> : <MoveHorizontalIcon />}
                    {option.label}
                  </span>
                ),
              }))}
              onChange={(value) => update({ wheelBehavior: value })}
              className="w-44"
            />
          )}
        </SettingRow>
        <SettingRow
          title="Snap to whole pixels"
          description="Round the position and size of shapes while you move, resize and draw."
        >
          {({ labelId, descriptionId }) => (
            <Switch
              aria-labelledby={labelId}
              aria-describedby={descriptionId}
              checked={snapToPixel}
              onCheckedChange={(checked) => update({ snapToPixel: checked })}
            />
          )}
        </SettingRow>
      </SettingsSection>

      <Button variant="outline" size="sm" onClick={reset}>
        Reset to defaults
      </Button>
    </div>
  );
};
