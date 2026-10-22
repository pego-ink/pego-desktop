import {
  ArrowDownUpIcon,
  ArrowRightIcon,
  ChevronsRightIcon,
  MoveHorizontalIcon,
} from "lucide-react";
import { Button } from "@pego/ui/components/button";
import { NumberField } from "@pego/ui/components/number-field";
import { SegmentedControl } from "@pego/ui/components/segmented-control";
import { Switch } from "@pego/ui/components/switch";
import { toggleAutoSave } from "@/persistence/autosave-actions";
import { isFileAutosaveSupported } from "@/persistence/file-autosave";
import { useAutosaveStore } from "@/persistence/use-autosave-store";
import { useSettingsStore, type EditorSettings } from "@/store/use-settings-store";
import { SettingRow, SettingsSection } from "./SettingRow";

const WHEEL_OPTIONS = [
  { value: "pan", label: "Pan", title: "Mouse wheel scrolls the canvas" },
  { value: "zoom", label: "Zoom", title: "Mouse wheel zooms at the cursor" },
] as const satisfies readonly {
  value: EditorSettings["wheelBehavior"];
  label: string;
  title: string;
}[];

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

export const GeneralSettingsTab = () => {
  const autosaveEnabled = useAutosaveStore((s) => s.enabled);
  const supported = isFileAutosaveSupported();
  const nudgeSmall = useSettingsStore((s) => s.nudgeSmall);
  const nudgeLarge = useSettingsStore((s) => s.nudgeLarge);
  const wheelBehavior = useSettingsStore((s) => s.wheelBehavior);
  const snapToPixel = useSettingsStore((s) => s.snapToPixel);
  const update = useSettingsStore((s) => s.update);
  const reset = useSettingsStore((s) => s.reset);

  return (
    <div>
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
