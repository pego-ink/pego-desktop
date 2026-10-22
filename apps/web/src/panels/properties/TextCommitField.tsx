import { Input } from "@pego/ui/components/input";
import { Textarea } from "@pego/ui/components/textarea";

type Props = {
  value: string;
  label: string;
  placeholder?: string;
  onCommit: (value: string) => void;
};

const commitIfChanged = (next: string, value: string, onCommit: (v: string) => void) => {
  if (next !== value) onCommit(next);
};

/** Text input that commits on Enter/blur and reverts on Escape. Remounts when `value` changes. */
export const TextCommitField = ({ value, label, placeholder, onCommit }: Props) => (
  <Input
    key={value}
    defaultValue={value}
    aria-label={label}
    placeholder={placeholder}
    spellCheck={false}
    onBlur={(event) => commitIfChanged(event.currentTarget.value, value, onCommit)}
    onKeyDown={(event) => {
      if (event.key === "Enter") event.currentTarget.blur();
      if (event.key === "Escape") {
        event.currentTarget.value = value;
        event.currentTarget.blur();
      }
    }}
  />
);

/** Multi-line variant: Enter inserts a newline, blur commits, Escape reverts. */
export const TextCommitArea = ({ value, label, placeholder, onCommit }: Props) => (
  <Textarea
    key={value}
    defaultValue={value}
    aria-label={label}
    placeholder={placeholder}
    onBlur={(event) => commitIfChanged(event.currentTarget.value, value, onCommit)}
    onKeyDown={(event) => {
      if (event.key === "Escape") {
        event.currentTarget.value = value;
        event.currentTarget.blur();
      }
    }}
  />
);
