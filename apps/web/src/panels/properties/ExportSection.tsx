import { useState } from "react";
import { toast } from "sonner";
import { CodeIcon } from "lucide-react";
import type { PegoNode } from "@pego/doc";
import { Button } from "@pego/ui/components/button";
import { NativeSelect } from "@pego/ui/components/native-select";
import { PropertySection } from "@pego/ui/components/property-section";
import { useDocumentStore } from "@/store/use-document-store";
import { CodePreviewDialog } from "@/export/CodePreviewDialog";
import { downloadBlob, downloadText } from "@/export/download";
import {
  codeFileName,
  EXPORT_FORMATS,
  exportBaseName,
  imageFileName,
  isCodeFormat,
  joinFilesForCopy,
  mimeFor,
  pngScale,
  type ExportFormat,
} from "@/export/export-formats";
import { generateCode, generatePng, generateSvg } from "@/export/generate";

const groups = ["Image", "Code"] as const;

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "Export failed");

/** Export the selected layer as PNG, SVG or code (download, copy, or preview). */
export const ExportSection = ({ node }: { node: PegoNode }) => {
  const [format, setFormat] = useState<ExportFormat>("png-2x");
  const [busy, setBusy] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const code = isCodeFormat(format) ? format : undefined;

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    try {
      await task();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const currentDoc = () => useDocumentStore.getState().doc;

  const exportFile = () =>
    run(async () => {
      const base = exportBaseName(node);
      const scale = pngScale(format);
      if (scale !== undefined) {
        const { blob } = await generatePng(currentDoc(), node.id, scale);
        downloadBlob(blob, imageFileName(base, format));
      } else if (code) {
        const files = await generateCode(currentDoc(), node.id, code);
        for (const file of files)
          downloadText(codeFileName(file.path), file.contents, mimeFor(file.path));
      } else {
        downloadText(
          imageFileName(base, format),
          await generateSvg(currentDoc(), node.id),
          "image/svg+xml",
        );
      }
    });

  const copyCode = () =>
    run(async () => {
      if (!code) return;
      const files = await generateCode(currentDoc(), node.id, code);
      await navigator.clipboard.writeText(joinFilesForCopy(files));
      toast.success("Code copied");
    });

  return (
    <PropertySection title="Export">
      <NativeSelect
        aria-label="Export format"
        value={format}
        onChange={(event) => setFormat(event.target.value as ExportFormat)}
      >
        {groups.map((group) => (
          <optgroup key={group} label={group}>
            {EXPORT_FORMATS.filter((f) => f.group === group).map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </optgroup>
        ))}
      </NativeSelect>
      <div className="flex gap-2">
        <Button size="xs" className="h-7 flex-1" disabled={busy} onClick={exportFile}>
          Export
        </Button>
        {code ? (
          <>
            <Button
              size="xs"
              variant="secondary"
              className="h-7 flex-1"
              disabled={busy}
              onClick={copyCode}
            >
              Copy code
            </Button>
            <Button
              size="icon-xs"
              variant="secondary"
              className="size-7"
              title="Preview code"
              aria-label="Preview code"
              onClick={() => setPreviewOpen(true)}
            >
              <CodeIcon />
            </Button>
          </>
        ) : null}
      </div>
      {code ? (
        <CodePreviewDialog
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          nodeId={node.id}
          format={code}
        />
      ) : null}
    </PropertySection>
  );
};
