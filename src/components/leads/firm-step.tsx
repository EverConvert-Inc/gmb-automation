import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { fuDone } from "./firm-ui";

/** One numbered onboarding step: number, title, one line, done / not done. */
export function FirmStep({
  n,
  title,
  hint,
  done,
  children,
}: {
  n: number;
  title: string;
  hint: string;
  done: boolean;
  children?: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`firm-step-${n}`} className="rounded-xl border bg-card p-5 shadow-sm sm:p-6">
      <div className="mb-4 flex items-start gap-3">
        <span
          aria-hidden
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
            done ? fuDone : "bg-muted text-muted-foreground",
          )}
        >
          {done ? <Check className="h-4 w-4" /> : n}
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={`firm-step-${n}`} className="text-base font-semibold leading-7">
            {title}
          </h2>
          <p className="text-sm text-muted-foreground">{hint}</p>
        </div>
        <span
          data-step-state={done ? "done" : "todo"}
          className={cn(
            "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium",
            done ? fuDone : "border text-muted-foreground",
          )}
        >
          {done ? "Done" : "Not done"}
        </span>
      </div>
      {children}
    </section>
  );
}
