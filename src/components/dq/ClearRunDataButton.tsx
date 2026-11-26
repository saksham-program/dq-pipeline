import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { clearRunData } from "@/lib/dq/db";

export function ClearRunDataButton() {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const clear = useMutation({
    mutationFn: clearRunData,
    onSuccess: async (count) => {
      toast.success(`Cleared ${count} run${count === 1 ? "" : "s"} and all run results`);
      await queryClient.invalidateQueries();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <>
      <Button variant="outline" disabled={clear.isPending} onClick={() => setConfirming(true)}>
        <Trash2 className="size-4" />
        {clear.isPending ? "Clearing…" : "Clear run data"}
      </Button>
      {confirming && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-4 backdrop-blur-sm">
          <section role="alertdialog" aria-labelledby="clear-run-data-title" aria-describedby="clear-run-data-description" className="w-full max-w-lg space-y-5 border bg-card p-6 shadow-lg">
            <header className="flex items-start gap-3">
              <span className="rounded-md bg-destructive/10 p-2 text-destructive"><AlertTriangle className="size-5" /></span>
              <div className="space-y-2">
                <h2 id="clear-run-data-title" className="text-lg font-semibold">Clear all run history and results?</h2>
                <p id="clear-run-data-description" className="text-sm text-muted-foreground">This permanently removes pipeline runs, logs, validation results, and accepted or rejected records. Uploaded datasets and their validation rules will stay. An active pipeline must finish first.</p>
              </div>
            </header>
            <footer className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirming(false)} disabled={clear.isPending}>Cancel</Button>
              <Button variant="destructive" onClick={() => { setConfirming(false); clear.mutate(); }} disabled={clear.isPending}>Clear run data</Button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}