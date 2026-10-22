import { useState } from "react";
import { DownloadIcon } from "lucide-react";
import type { PegoNode } from "@pego/doc";
import { Button } from "@pego/ui/components/button";
import { NativeSelect } from "@pego/ui/components/native-select";
import { PropertyRow, PropertySection } from "@pego/ui/components/property-section";
import { EXPORT_FORMATS, exportNode, type ExportFormat } from "@/export/export-actions";

/** Download the selected node as PNG, SVG or HTML/CSS. */
export const ExportSection = ({ node }: { node: PegoNode }) => {
  const [format, setFormat] = useState<ExportFormat>("png@2x");
  const [busy, setBusy] = useState(false);
  return (
    <PropertySection title="Export">
      <PropertyRow className="grid-cols-[1fr_auto]">
        <NativeSelect
          aria-label="Export format"
          value={format}
          onChange={(event) => setFormat(event.target.value as ExportFormat)}
        >
          {EXPORT_FORMATS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </NativeSelect>
        <Button
          variant="secondary"
          size="xs"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void exportNode(node.id, format).finally(() => setBusy(false));
          }}
        >
          <DownloadIcon />
          Export
        </Button>
      </PropertyRow>
    </PropertySection>
  );
};
