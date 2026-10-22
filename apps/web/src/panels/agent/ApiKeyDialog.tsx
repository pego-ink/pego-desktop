import { useState, type FormEvent } from "react";
import { Button } from "@pego/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@pego/ui/components/dialog";
import { Input } from "@pego/ui/components/input";
import { saveApiKey } from "@/agent/api-key";
import { safely } from "@/panels/agent/run-actions";

type ApiKeyDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hasKey: boolean;
  onChanged: (hasKey: boolean) => void;
};

const ApiKeyForm = ({ onOpenChange, hasKey, onChanged }: Omit<ApiKeyDialogProps, "open">) => {
  const [value, setValue] = useState("");

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const key = value.trim();
    if (!key) return;
    if (await safely(() => saveApiKey(key))) {
      onChanged(true);
      onOpenChange(false);
    }
  };

  const remove = async () => {
    if (await safely(() => saveApiKey(null))) {
      onChanged(false);
      onOpenChange(false);
    }
  };

  return (
    <form onSubmit={(event) => void save(event)} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{hasKey ? "Replace API key" : "Anthropic API key"}</DialogTitle>
        <DialogDescription>
          Saved locally in this browser. It is only sent to api.anthropic.com.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Input
          type="password"
          autoComplete="off"
          spellCheck={false}
          autoFocus
          aria-label="API key"
          placeholder="sk-ant-…"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <p className="text-[11px] text-muted-foreground">
          Create one at{" "}
          <a
            href="https://console.anthropic.com"
            target="_blank"
            rel="noreferrer"
            className="text-foreground underline underline-offset-2"
          >
            console.anthropic.com
          </a>
          .
        </p>
      </div>
      <DialogFooter>
        {hasKey ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mr-auto text-destructive hover:text-destructive"
            onClick={() => void remove()}
          >
            Remove key
          </Button>
        ) : null}
        <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={value.trim().length === 0}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
};

export const ApiKeyDialog = ({ open, onOpenChange, hasKey, onChanged }: ApiKeyDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <ApiKeyForm onOpenChange={onOpenChange} hasKey={hasKey} onChanged={onChanged} />
    </DialogContent>
  </Dialog>
);
