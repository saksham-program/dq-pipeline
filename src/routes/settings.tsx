import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PageHeader, Panel } from "@/components/dq/common";
import { DEFAULT_SETTINGS, loadSampleData, purgeOldRuns, resetSampleData, saveSettings, type AppSettings } from "@/lib/dq/db";
import { useSettings } from "@/lib/dq/hooks";
import { RANGE_LABEL, useAppState, type DateRange, type ThemePref } from "@/lib/app-state";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — DQ Pipeline" },
      { name: "description", content: "Theme, processing defaults, upload limits, retention and demonstration data controls." },
      { property: "og:title", content: "Settings — DQ Pipeline" },
      { property: "og:description", content: "Configure DQ Pipeline processing preferences." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SettingsPage,
});

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <div className="flex flex-col gap-2 border-b py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between"><div><div className="text-sm font-medium">{label}</div>{hint && <div className="text-xs text-muted-foreground">{hint}</div>}</div><div className="sm:w-56">{children}</div></div>;
}

function SettingsPage() {
  const { data } = useSettings();
  const { theme, setTheme, setRange } = useAppState();
  const qc = useQueryClient();
  const [s, setS] = useState<AppSettings>(DEFAULT_SETTINGS);
  useEffect(() => { if (data) setS(data); }, [data]);
  const save = useMutation({ mutationFn: () => saveSettings(s), onSuccess: () => { setRange(s.defaultRange as DateRange); toast.success("Settings saved"); qc.invalidateQueries({ queryKey: ["settings"] }); }, onError: (e: Error) => toast.error(e.message) });
  const reset = useMutation({ mutationFn: resetSampleData, onSuccess: () => { toast.success("Demonstration data removed"); qc.invalidateQueries(); }, onError: (e: Error) => toast.error(e.message) });
  const load = useMutation({ mutationFn: loadSampleData, onSuccess: () => { toast.success("Demonstration data loaded"); qc.invalidateQueries(); }, onError: (e: Error) => toast.error(e.message) });
  const purge = useMutation({ mutationFn: () => purgeOldRuns(s.retentionDays!), onSuccess: (n) => { toast.success(`Deleted ${n} run(s)`); qc.invalidateQueries(); }, onError: (e: Error) => toast.error(e.message) });
  const p = s.processing;
  const setP = (k: keyof typeof p, v: boolean) => setS({ ...s, processing: { ...p, [k]: v } });

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Settings" description="Preferences are stored in your workspace database." actions={<Button onClick={() => save.mutate()} disabled={save.isPending}>Save settings</Button>} />
      <Panel title="Appearance">
        <Row label="Theme" hint="Saved on this device; applied instantly"><Select value={theme} onValueChange={(v) => setTheme(v as ThemePref)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="light">Light</SelectItem><SelectItem value="dark">Dark</SelectItem><SelectItem value="system">System</SelectItem></SelectContent></Select></Row>
        <Row label="Default date range"><Select value={s.defaultRange} onValueChange={(v) => setS({ ...s, defaultRange: v as AppSettings["defaultRange"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{(Object.keys(RANGE_LABEL) as DateRange[]).map((r) => <SelectItem key={r} value={r}>{RANGE_LABEL[r]}</SelectItem>)}</SelectContent></Select></Row>
      </Panel>
      <Panel title="Validation & cleaning defaults">
        <Row label="Default severity for new rules"><Select value={s.defaultSeverity} onValueChange={(v) => setS({ ...s, defaultSeverity: v as AppSettings["defaultSeverity"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="critical">Critical</SelectItem><SelectItem value="error">Error</SelectItem><SelectItem value="warning">Warning</SelectItem></SelectContent></Select></Row>
        <Row label="Reject rows on warnings" hint="Off: warnings are logged but rows are accepted"><Switch checked={p.rejectOnWarning} onCheckedChange={(v) => setP("rejectOnWarning", v)} aria-label="Reject on warnings" /></Row>
        <Row label="Trim whitespace" hint="Applied to accepted copy only"><Switch checked={p.trimWhitespace} onCheckedChange={(v) => setP("trimWhitespace", v)} aria-label="Trim whitespace" /></Row>
        <Row label="Lower-case email columns"><Switch checked={p.lowercaseEmails} onCheckedChange={(v) => setP("lowercaseEmails", v)} aria-label="Lowercase emails" /></Row>
      </Panel>
      <Panel title="Ingestion">
        <Row label="CSV upload limit (MB)"><Input type="number" min={1} max={20} value={s.maxUploadMb} onChange={(e) => setS({ ...s, maxUploadMb: Math.min(20, Math.max(1, Number(e.target.value) || 1)) })} /></Row>
        <Row label="API source configuration" hint="Requests run through the app server with a 15 s timeout; private network addresses are blocked. Edit per-source URLs and headers on Data Sources."><span className="text-xs text-muted-foreground">Per source</span></Row>
      </Panel>
      <Panel title="Data retention">
        <Row label="Keep runs for (days)" hint="Leave empty to keep everything"><Input type="number" min={1} value={s.retentionDays ?? ""} onChange={(e) => setS({ ...s, retentionDays: e.target.value ? Number(e.target.value) : null })} /></Row>
        <div className="pt-3"><Button variant="outline" size="sm" disabled={!s.retentionDays || purge.isPending} onClick={() => purge.mutate()}>Delete runs older than {s.retentionDays ?? "—"} days now</Button></div>
      </Panel>
      <Panel title="Demonstration data" description="Demo datasets are labelled [Demo] and kept separate from your own uploads.">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => load.mutate()} disabled={load.isPending}>Load sample data</Button>
          <AlertDialog>
            <AlertDialogTrigger asChild><Button variant="destructive">Clear sample data</Button></AlertDialogTrigger>
            <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Remove all demonstration data?</AlertDialogTitle><AlertDialogDescription>Deletes demo datasets, their rules, runs, logs and records. Your own uploads are not touched.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => reset.mutate()}>Remove</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
          </AlertDialog>
        </div>
      </Panel>
    </div>
  );
}
