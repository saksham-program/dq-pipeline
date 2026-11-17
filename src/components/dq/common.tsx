import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, Circle, Loader2, Minus, XCircle, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { STAGES, type StageName, type StageStatus } from "@/lib/dq/types";

const STATUS_STYLE: Record<string, string> = {
  success: "bg-success/12 text-success border-success/30",
  matched: "bg-success/12 text-success border-success/30",
  completed: "bg-success/12 text-success border-success/30",
  partial_success: "bg-warning/12 text-warning border-warning/30",
  not_evaluated: "bg-muted text-muted-foreground border-border",
  awaiting_run: "bg-primary/10 text-primary border-primary/30",
  warning: "bg-warning/12 text-warning border-warning/30",
  failed: "bg-destructive/12 text-destructive border-destructive/30",
  mismatch: "bg-destructive/12 text-destructive border-destructive/30",
  critical: "bg-destructive/12 text-destructive border-destructive/30",
  error: "bg-destructive/10 text-destructive border-destructive/25",
  running: "bg-cyan/12 text-cyan border-cyan/30",
  pending: "bg-muted text-muted-foreground border-border",
  csv: "bg-accent text-accent-foreground border-transparent",
  api: "bg-insight/12 text-insight border-insight/30",
  demo: "bg-insight/12 text-insight border-insight/30",
};
const LABEL: Record<string, string> = { partial_success: "Partial success", not_evaluated: "Not evaluated", awaiting_run: "Awaiting run" };

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold capitalize tracking-wide whitespace-nowrap", STATUS_STYLE[status] ?? STATUS_STYLE["pending"], className)}>
      {status === "running" ? <Loader2 className="size-3 animate-spin" /> : <span className="size-1.5 rounded-full bg-current opacity-80" />}
      {LABEL[status] ?? status.replace(/_/g, " ")}
    </span>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export type KpiTrend = { delta: number | null; goodWhenUp?: boolean; label?: string };

function TrendChip({ trend }: { trend: KpiTrend }) {
  const { delta, goodWhenUp = true, label = "vs earlier runs" } = trend;
  if (delta == null) return null;
  const flat = Math.abs(delta) < 0.05;
  const up = delta > 0;
  const good = flat ? null : up === goodWhenUp;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground" title={label}>
      <span className={cn("inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold", good === null ? "bg-muted text-muted-foreground" : good ? "bg-success/12 text-success" : "bg-destructive/12 text-destructive")}>
        <Icon className="size-3" />{flat ? "0%" : `${Math.abs(delta).toFixed(1)}%`}
      </span>
      <span className="hidden truncate sm:inline">{label}</span>
    </span>
  );
}

export function Kpi({ label, value, hint, icon: Icon, tone = "primary", trend }: { label: string; value: ReactNode; hint?: ReactNode; icon: LucideIcon; tone?: "primary" | "success" | "destructive" | "warning" | "insight" | "cyan"; trend?: KpiTrend }) {
  const tones = { primary: "text-primary bg-primary/10 ring-primary/15", success: "text-success bg-success/10 ring-success/15", destructive: "text-destructive bg-destructive/10 ring-destructive/15", warning: "text-warning bg-warning/12 ring-warning/20", insight: "text-insight bg-insight/10 ring-insight/15", cyan: "text-cyan bg-cyan/10 ring-cyan/15" };
  return (
    <div className="surface group p-5 transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-soft hover:shadow-elevated">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-muted-foreground">{label}</span>
        <span className={cn("rounded-lg p-2 ring-1 transition-transform duration-200 group-hover:scale-105", tones[tone])}><Icon className="size-4" /></span>
      </div>
      <div className="mt-3 font-display text-[1.75rem] leading-none font-bold tracking-tight tabular-nums">{value}</div>
      {(hint || trend) && (
        <div className="mt-2.5 flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {trend && <TrendChip trend={trend} />}
          {hint && <span>{hint}</span>}
        </div>
      )}
    </div>
  );
}

export function Panel({ title, description, actions, children, className }: { title?: string; description?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("surface overflow-hidden", className)}>
      {title && (
        <header className="flex items-start justify-between gap-2 border-b border-border/70 px-5 py-3.5">
          <div>
            <h2 className="text-sm font-bold">{title}</h2>
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Empty({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
      <div className="rounded-full bg-accent p-3 ring-8 ring-accent/40"><Icon className="size-5 text-primary" /></div>
      <p className="text-sm font-medium">{title}</p>
      {children && <div className="max-w-sm text-xs text-muted-foreground">{children}</div>}
    </div>
  );
}

const STAGE_LABEL: Record<StageName, string> = { ingest: "Ingest", validate: "Validate", clean: "Clean", load: "Load", publish: "Publish" };
export function StageFlow({ stages }: { stages?: Partial<Record<StageName, StageStatus>> | null }) {
  return (
    <ol className="grid grid-cols-5 gap-1.5">
      {STAGES.map((s, i) => {
        const st = stages?.[s] ?? "pending";
        const Icon = st === "completed" ? CheckCircle2 : st === "failed" ? XCircle : st === "running" ? Loader2 : Circle;
        return (
          <li key={s} className="relative flex flex-col items-center gap-1.5">
            {i > 0 && <span className={cn("absolute top-3.5 right-1/2 h-px w-full -translate-x-3.5", st === "pending" ? "bg-border" : "bg-brand")} />}
            <span className={cn("relative z-10 flex size-7 items-center justify-center rounded-full border bg-card transition-colors duration-300", st === "completed" && "border-success/50 bg-success/10 text-success", st === "failed" && "border-destructive/50 text-destructive", st === "running" && "border-cyan/60 text-cyan", st === "pending" && "text-muted-foreground")}>
              <Icon className={cn("size-3.5", st === "running" && "animate-spin")} />
            </span>
            <span className="text-[11px] font-medium">{STAGE_LABEL[s]}</span>
            <span className="text-[10px] capitalize text-muted-foreground">{st}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function RunLink({ runId }: { runId: string }) {
  return <Link to="/runs/$runId" params={{ runId }} className="font-mono text-xs whitespace-nowrap text-primary hover:underline">{runId}</Link>;
}

export function WarnNote({ children }: { children: ReactNode }) {
  return <div className="flex gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-warning"><AlertTriangle className="size-4 shrink-0" /><div>{children}</div></div>;
}

export const fmt = (n: number | null | undefined) => (n ?? 0).toLocaleString();
export const fmtMs = (ms: number | null | undefined) => (ms == null ? "—" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`);
export const fmtDate = (d: string | null | undefined) => (d ? new Date(d).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—");
export const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "—");
/** Quality of a run: never a percentage when no rule was executed. */
export const runQuality = (r: { status: string; accepted_count: number; source_count: number }) => (r.status === "not_evaluated" ? "Not evaluated" : pct(r.accepted_count, r.source_count));
