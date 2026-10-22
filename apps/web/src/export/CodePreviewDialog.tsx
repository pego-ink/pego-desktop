import { useEffect, useState } from "react";
import { CheckIcon, CopyIcon, DownloadIcon } from "lucide-react";
import type { CodeFormat, ExportFile } from "@pego/agent";
import { Button } from "@pego/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@pego/ui/components/dialog";
import { cn } from "@pego/ui/lib/utils";
import { useDocumentStore } from "@/store/use-document-store";
import { downloadText } from "@/export/download";
import { codeFileName, mimeFor } from "@/export/export-formats";
import { generateCode } from "@/export/generate";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nodeId: string;
  format: CodeFormat;
};

const FORMAT_LABEL: Record<CodeFormat, string> = {
  "react-tailwind": "React + Tailwind",
  "html-css": "HTML / CSS",
};

const PreviewBody = ({ nodeId, format }: { nodeId: string; format: CodeFormat }) => {
  const [files, setFiles] = useState<ExportFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    generateCode(useDocumentStore.getState().doc, nodeId, format).then(
      (generated) => !cancelled && setFiles(generated),
      (reason: unknown) =>
        !cancelled && setError(reason instanceof Error ? reason.message : "Export failed"),
    );
    return () => {
      cancelled = true;
    };
  }, [nodeId, format]);

  const file = files?.[active];

  const copy = async () => {
    if (!file) return;
    await navigator.clipboard.writeText(file.contents);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (error) {
    return (
      <p role="alert" className="text-xs text-destructive">
        {error}
      </p>
    );
  }
  if (!files) return <p className="text-xs text-muted-foreground">Generating...</p>;
  return (
    <>
      <div role="tablist" aria-label="Files" className="flex flex-wrap gap-1">
        {files.map((f, index) => (
          <button
            key={f.path}
            type="button"
            role="tab"
            aria-selected={index === active}
            onClick={() => setActive(index)}
            className={cn(
              "rounded-md px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              index === active
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {f.path}
          </button>
        ))}
      </div>
      <pre
        tabIndex={0}
        aria-label={file?.path}
        className="max-h-[55vh] overflow-auto rounded-md bg-muted p-3 font-mono text-[11px] leading-relaxed text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {file?.contents}
      </pre>
      <div className="flex items-center justify-end gap-2">
        <Button size="sm" variant="secondary" onClick={copy}>
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? "Copied" : "Copy code"}
        </Button>
        <Button
          size="sm"
          onClick={() =>
            file && downloadText(codeFileName(file.path), file.contents, mimeFor(file.path))
          }
        >
          <DownloadIcon />
          Download file
        </Button>
      </div>
    </>
  );
};

/** Read-only preview of the generated files, with copy and download per file. */
export const CodePreviewDialog = ({ open, onOpenChange, nodeId, format }: Props) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-3xl">
      <DialogHeader>
        <DialogTitle>{FORMAT_LABEL[format]}</DialogTitle>
        <DialogDescription>Generated from the selected layer.</DialogDescription>
      </DialogHeader>
      <PreviewBody nodeId={nodeId} format={format} />
    </DialogContent>
  </Dialog>
);
