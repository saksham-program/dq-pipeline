import { Link } from "@tanstack/react-router";
import { Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { PipelineRun } from "@/lib/dq/db";
import { Empty, RunLink, StatusBadge, fmt, fmtDate, fmtMs, runQuality } from "./common";

export function RunsTable({ runs, selected, onToggle }: { runs: PipelineRun[]; selected?: string[]; onToggle?: (id: string) => void }) {
  if (!runs.length) return <Empty icon={Activity} title="No runs match">Run a pipeline or adjust the filters.</Empty>;
  return (
    <div className="-m-5 overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {onToggle && <TableHead className="w-8"><span className="sr-only">Compare</span></TableHead>}
            <TableHead>Run ID</TableHead><TableHead>Dataset</TableHead><TableHead>Source</TableHead><TableHead>Started</TableHead><TableHead>Status</TableHead>
            <TableHead className="text-right">Source</TableHead><TableHead className="text-right">Accepted</TableHead><TableHead className="text-right">Rejected</TableHead><TableHead className="text-right">Quality</TableHead><TableHead className="text-right">Duration</TableHead><TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((r) => (
            <TableRow key={r.id}>
              {onToggle && <TableCell><Checkbox checked={!!selected?.includes(r.run_id)} onCheckedChange={() => onToggle(r.run_id)} aria-label={`Select ${r.run_id} for comparison`} /></TableCell>}
              <TableCell><RunLink runId={r.run_id} /></TableCell>
              <TableCell className="max-w-44 truncate text-xs">{r.dataset_name}</TableCell>
              <TableCell><StatusBadge status={r.source_type} /></TableCell>
              <TableCell className="text-xs whitespace-nowrap">{fmtDate(r.started_at)}</TableCell>
              <TableCell><StatusBadge status={r.status} /></TableCell>
              <TableCell className="text-right font-mono text-xs">{fmt(r.source_count)}</TableCell>
              <TableCell className="text-right font-mono text-xs text-success">{fmt(r.accepted_count)}</TableCell>
              <TableCell className="text-right font-mono text-xs text-destructive">{fmt(r.rejected_count)}</TableCell>
              <TableCell className="text-right font-mono text-xs">{runQuality(r)}</TableCell>
              <TableCell className="text-right font-mono text-xs">{fmtMs(r.duration_ms)}</TableCell>
              <TableCell><Button variant="ghost" size="sm" asChild><Link to="/runs/$runId" params={{ runId: r.run_id }}>Details</Link></Button></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
