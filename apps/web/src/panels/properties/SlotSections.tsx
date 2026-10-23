import { PlusIcon, XIcon } from "lucide-react";
import { findNode, type FrameNode, type Op, type RefNode } from "@pego/doc";
import { Button } from "@pego/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@pego/ui/components/dropdown-menu";
import { PropertySection } from "@pego/ui/components/property-section";
import {
  clearSlotOp,
  componentAround,
  componentChoices,
  fillSlotOp,
  nodeLabel,
  recommendOp,
  slotFill,
  slotsOf,
  toggleSlotOp,
} from "@/interaction/slots";
import { useDocumentStore } from "@/store/use-document-store";

const commit = (op: Op, label: string) => useDocumentStore.getState().commit([op], { label });

/**
 * On a frame inside a component: make it a slot (instances can fill it) and choose the components
 * recommended for it.
 */
export const SlotSection = ({ node }: { node: FrameNode }) => {
  const doc = useDocumentStore((s) => s.doc);
  const component = componentAround(doc, node.id);
  if (!component || component.id === node.id) return null;

  if (!node.slot) {
    return (
      <PropertySection title="Slot">
        <p className="text-[11px] leading-4 text-muted-foreground">
          A slot is a place each instance of {component.name ?? "the component"} can fill with its
          own content.
        </p>
        <Button
          variant="secondary"
          size="xs"
          onClick={() => commit(toggleSlotOp(node), "Make slot")}
        >
          Make slot
        </Button>
      </PropertySection>
    );
  }

  const recommended = node.slot;
  const choices = componentChoices(doc, component.id).filter(
    (choice) => !recommended.includes(choice.id),
  );
  return (
    <PropertySection
      title="Slot"
      action={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Recommend a component"
              title="Recommend a component"
              disabled={choices.length === 0}
              className="flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
            >
              <PlusIcon className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {choices.map((choice) => (
              <DropdownMenuItem
                key={choice.id}
                onSelect={() => commit(recommendOp(node, choice.id, true), "Recommend component")}
              >
                {choice.name ?? choice.type}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >
      {recommended.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">No recommended components yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {recommended.map((id) => (
            <li
              key={id}
              className="flex h-7 items-center gap-2 rounded-md bg-muted px-2 text-xs text-violet"
            >
              <span className="min-w-0 flex-1 truncate">{nodeLabel(doc, id)}</span>
              <button
                type="button"
                aria-label={`Remove ${nodeLabel(doc, id)} from the slot`}
                title="Remove from slot"
                onClick={() => commit(recommendOp(node, id, false), "Remove recommendation")}
                className="flex size-4 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
              >
                <XIcon className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Button variant="ghost" size="xs" onClick={() => commit(toggleSlotOp(node), "Remove slot")}>
        Remove slot
      </Button>
    </PropertySection>
  );
};

/** On an instance: fill each slot of its component with a recommended component, or reset it. */
export const InstanceSlotsSection = ({ node }: { node: RefNode }) => {
  const doc = useDocumentStore((s) => s.doc);
  const component = findNode(doc, node.ref);
  if (!component?.reusable) return null;
  const slots = slotsOf(component);
  if (slots.length === 0) return null;
  return (
    <PropertySection title="Slots">
      {slots.map((slot) => {
        const fill = slotFill(node, slot.id);
        const first = fill?.[0];
        return (
          <div key={slot.id} className="flex flex-col gap-1.5">
            <div className="flex h-5 items-center justify-between text-[11px]">
              <span className="truncate text-muted-foreground">{slot.name ?? "Slot"}</span>
              {fill ? (
                <button
                  type="button"
                  onClick={() => commit(clearSlotOp(node, slot.id), "Reset slot")}
                  className="text-muted-foreground hover:text-foreground"
                >
                  Reset
                </button>
              ) : null}
            </div>
            {fill ? (
              <div className="flex h-7 items-center rounded-md bg-muted px-2 text-xs text-violet">
                <span className="truncate">
                  {first?.type === "ref" ? nodeLabel(doc, first.ref) : "Own content"}
                </span>
              </div>
            ) : (slot.slot ?? []).length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {(slot.slot ?? []).map((id) => (
                  <Button
                    key={id}
                    variant="secondary"
                    size="xs"
                    disabled={findNode(doc, id)?.reusable !== true}
                    onClick={() => commit(fillSlotOp(node, slot.id, id), "Fill slot")}
                  >
                    <PlusIcon />
                    {nodeLabel(doc, id)}
                  </Button>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                The component recommends nothing for this slot.
              </p>
            )}
          </div>
        );
      })}
    </PropertySection>
  );
};
