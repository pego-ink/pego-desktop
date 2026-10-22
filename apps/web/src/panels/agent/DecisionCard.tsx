import { CircleAlertIcon } from "lucide-react";
import { Button } from "@pego/ui/components/button";
import { answerDecision } from "@/agent/run";
import type { PendingDecision } from "@/agent/use-agent-store";
import { safely } from "@/panels/agent/run-actions";

export const DecisionCard = ({ decision }: { decision: PendingDecision }) => (
  <section
    aria-label="Needs your decision"
    className="rounded-lg border border-foreground/70 bg-card p-3"
  >
    <h3 className="flex items-center gap-1.5 text-[13px] font-semibold">
      <CircleAlertIcon className="size-4" />
      Needs your decision
    </h3>
    <p className="mt-2 text-xs leading-5 text-foreground">{decision.question}</p>
    <div className="mt-3 flex flex-wrap gap-2">
      {decision.options.map((option, index) => (
        <Button
          key={option}
          size="sm"
          variant={index === 0 ? "secondary" : "ghost"}
          onClick={() => void safely(() => answerDecision(decision.id, option))}
        >
          {option}
        </Button>
      ))}
    </div>
  </section>
);
