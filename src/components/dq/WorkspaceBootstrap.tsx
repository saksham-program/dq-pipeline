import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { confirmFreshWorkspace, getSettings, saveSettings, startWorkspace } from "@/lib/dq/db";
import { APP_LAUNCH_ID, envAllowsAutoReset } from "@/lib/dq/launch";
import { describeSummary, type StartupResult, type WorkspaceCounts } from "@/lib/dq/workspace";

// One startup evaluation per page load. Module scope survives React StrictMode double-mounts and component
// remounts during hot reload, so this can never fire repeatedly. A browser refresh is a new page load, but it
// presents the same APP_LAUNCH_ID, which the database has already claimed — so nothing is reset.
let startup: Promise<StartupResult | null> | null = null;
let announced = false;
let dismissed = false; // "Decide later" / a choice made: do not re-prompt on remount within this page load

function evaluateStartup(): Promise<StartupResult | null> {
  startup ??= (async () => {
    const settings = await getSettings();
    return startWorkspace({ mode: settings.workspaceMode, allowed: envAllowsAutoReset(), launchId: APP_LAUNCH_ID });
  })().catch((e: Error) => {
    toast.error(`Workspace startup check failed: ${e.message}`);
    return null;
  });
  return startup;
}

export function WorkspaceBootstrap() {
  const qc = useQueryClient();
  const [pending, setPending] = useState<WorkspaceCounts | null>(null);
  const [busy, setBusy] = useState<"fresh" | "keep" | null>(null);

  useEffect(() => {
    let cancelled = false;
    void evaluateStartup().then((r) => {
      if (cancelled || !r) return;
      if (r.action === "needs-confirmation" && !dismissed) setPending(r.counts);
      if (r.action === "initialized" && !announced) {
        announced = true;
        toast.success("Fresh demo workspace initialized", { description: r.summary ? `Cleared ${describeSummary(r.summary)}.` : "The workspace is empty and ready — upload a dataset or connect an API to begin.", duration: 8000 });
        qc.invalidateQueries();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [qc]);

  if (!pending) return null;
  const total = pending.datasets + pending.rules + pending.runs + pending.acceptedRecords + pending.rejectedRecords;

  const startFresh = async () => {
    setBusy("fresh");
    try {
      const summary = await confirmFreshWorkspace(APP_LAUNCH_ID);
      announced = true;
      toast.success("Fresh demo workspace initialized", { description: `Cleared ${describeSummary(summary)}. Future launches of the dev server will start empty.`, duration: 8000 });
      dismissed = true;
      setPending(null);
      qc.invalidateQueries();
    } catch (e) {
      toast.error(`Nothing was deleted: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };
  const keepData = async () => {
    setBusy("keep");
    try {
      const s = await getSettings();
      await saveSettings({ ...s, workspaceMode: "persistent" });
      toast.success("Switched to Persistent Workspace — your data is kept.");
      dismissed = true;
      setPending(null);
      qc.invalidateQueries({ queryKey: ["settings"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Start this launch with a fresh demo workspace?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm">
              <p>Workspace Startup Mode is <strong>Fresh Demo Workspace</strong>, but this database already contains data. DQ Pipeline cannot tell your own uploads from demo data, so it will not delete anything until you confirm.</p>
              <ul className="rounded-md border p-3 text-xs">
                <li>{pending.datasets} dataset(s) ({pending.sampleDatasets} built-in sample)</li>
                <li>{pending.rules} validation rule(s)</li>
                <li>{pending.runs} pipeline run(s), {pending.acceptedRecords + pending.rejectedRecords} accepted/rejected record(s)</li>
              </ul>
              <p><strong>Start fresh</strong> deletes all {total} of those rows now, and from then on every new launch of the dev server starts empty (a browser refresh never does). Settings, the schema and migrations are kept. <strong>Keep my data</strong> switches to Persistent Workspace. You can change this any time in Settings.</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <Button variant="outline" onClick={() => { dismissed = true; setPending(null); }} disabled={busy !== null}>Decide later</Button>
          <Button variant="outline" onClick={keepData} disabled={busy !== null}>{busy === "keep" && <Loader2 className="size-4 animate-spin" />}Keep my data</Button>
          <Button variant="destructive" onClick={startFresh} disabled={busy !== null}>{busy === "fresh" && <Loader2 className="size-4 animate-spin" />}Start fresh</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
