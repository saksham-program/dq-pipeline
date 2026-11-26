import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Bell, ChevronsLeft, Database, FileBarChart, History, LayoutDashboard, ListChecks, Menu, Moon, Play, Search, Settings, Sun, Table2, Workflow, Monitor } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { RANGE_LABEL, useAppState, type DateRange } from "@/lib/app-state";
import { useRuns } from "@/lib/dq/hooks";
import { cn } from "@/lib/utils";
import { RunPipelineDialog } from "./RunPipelineDialog";
import { HeaderWaves, PageWaves, SidebarWaves } from "./Waves";
import { BrandLogo } from "./BrandLogo";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/sources", label: "Data Sources", icon: Database },
  { to: "/rules", label: "Validation Rules", icon: ListChecks },
  { to: "/runs", label: "Pipeline Runs", icon: Workflow },
  { to: "/explorer", label: "Data Explorer", icon: Table2 },
  { to: "/history", label: "Run History", icon: History },
  { to: "/reports", label: "Reports", icon: FileBarChart },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

function Brand({ collapsed }: { collapsed?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 px-1">
      <BrandLogo />
      {!collapsed && (
        <div className="leading-tight">
          <div className="font-display text-[15px] font-bold tracking-tight">DQ Pipeline</div>
          <div className="text-[10px] font-medium tracking-wide text-muted-foreground">Validate · Monitor · Publish</div>
        </div>
      )}
    </div>
  );
}

function NavList({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Main">
      {NAV.map(({ to, label, icon: Icon }) => {
        const active = to === "/" ? path === "/" : path.startsWith(to);
        return (
          <Link key={to} to={to} onClick={onNavigate} title={collapsed ? label : undefined} className={cn("group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all duration-200", collapsed && "justify-center px-0", active ? "bg-nav-active font-semibold text-sidebar-accent-foreground shadow-soft" : "font-medium text-sidebar-foreground/80 hover:translate-x-0.5 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground")}>
            {active && <span className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-brand" />}
            <Icon className={cn("size-4 shrink-0 transition-colors", active ? "text-sidebar-primary" : "text-muted-foreground group-hover:text-sidebar-primary")} />
            {!collapsed && <span className="truncate">{label}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

/** Atmosphere behind content: fine grid, soft light pools and the route's signature waves. */
function Backdrop({ path }: { path: string }) {
  return (
    <>
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="bg-grid absolute inset-x-0 top-0 h-[520px] [mask-image:radial-gradient(ellipse_70%_60%_at_70%_0%,black,transparent)]" />
        <div className="absolute -top-24 right-[8%] size-[420px] rounded-full bg-blob blur-3xl" />
        <div className="absolute bottom-[-160px] left-[20%] size-[520px] rounded-full bg-blob blur-3xl" />
      </div>
      <PageWaves path={path} />
    </>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [q, setQ] = useState("");
  const { theme, setTheme, resolved, range, setRange } = useAppState();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const { data: runs } = useRuns();
  const recentFailed = (runs ?? []).filter((r) => r.status === "failed" || r.status === "partial_success").slice(0, 5);
  const current = NAV.find((n) => (n.to === "/" ? path === "/" : path.startsWith(n.to)));
  const isDetail = path.startsWith("/runs/");

  return (
    <div className="relative isolate flex min-h-screen">
      <Backdrop path={path} />
      <aside className={cn("sticky top-0 z-20 hidden h-screen shrink-0 isolate flex-col overflow-hidden border-r bg-sidebar p-3 transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] lg:flex", collapsed ? "w-[72px]" : "w-64")}>
        <div className="mb-7 px-1 pt-1"><Brand collapsed={collapsed} /></div>
        {!collapsed && <div className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground/80">Workspace</div>}
        <NavList collapsed={collapsed} />
        <button onClick={() => setCollapsed((c) => !c)} className={cn("mt-auto flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground", collapsed && "justify-center px-0")} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          <ChevronsLeft className={cn("size-4 transition-transform duration-200", collapsed && "rotate-180")} />
          {!collapsed && "Collapse"}
        </button>
        <SidebarWaves />
      </aside>

      <Sheet open={mobile} onOpenChange={setMobile}>
        <SheetContent side="left" className="isolate w-72 overflow-hidden bg-sidebar p-3">
          <SidebarWaves />
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <div className="mb-6 pt-1"><Brand /></div>
          <NavList onNavigate={() => setMobile(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b bg-topbar px-3 shadow-soft backdrop-blur-xl sm:px-6">
          <HeaderWaves />
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobile(true)} aria-label="Open navigation"><Menu className="size-4" /></Button>
          <div className="min-w-0">
            <div className="hidden text-[11px] text-muted-foreground sm:block">
              <Link to="/" className="hover:text-foreground">DQ Pipeline</Link>
              {isDetail && <> / <Link to="/runs" className="hover:text-foreground">Pipeline Runs</Link></>}
            </div>
            <div className="truncate font-display text-[15px] font-bold tracking-tight">{isDetail ? path.split("/")[2] : current?.label}</div>
          </div>
          <form className="relative ml-auto hidden md:block" onSubmit={(e) => { e.preventDefault(); if (q.trim()) navigate({ to: "/history", search: { q: q.trim() } }); }}>
            <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search runs, datasets…" className="h-9 w-60 rounded-full bg-background/60 pl-8 text-xs" aria-label="Search runs" />
          </form>
          <Select value={range} onValueChange={(v) => setRange(v as DateRange)}>
            <SelectTrigger className="ml-auto h-9 w-[136px] rounded-full text-xs md:ml-0" aria-label="Date range"><SelectValue /></SelectTrigger>
            <SelectContent>{(Object.keys(RANGE_LABEL) as DateRange[]).map((r) => <SelectItem key={r} value={r}>{RANGE_LABEL[r]}</SelectItem>)}</SelectContent>
          </Select>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
                <Bell className="size-4" />
                {recentFailed.length > 0 && <span className="absolute top-2 right-2 size-2 rounded-full bg-destructive ring-2 ring-card" />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel>Runs needing attention</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {recentFailed.length === 0 && <div className="px-2 py-3 text-xs text-muted-foreground">No failed or partial runs.</div>}
              {recentFailed.map((r) => (
                <DropdownMenuItem key={r.id} onClick={() => navigate({ to: "/runs/$runId", params: { runId: r.run_id } })} className="flex-col items-start">
                  <span className="font-mono text-xs">{r.run_id} · {r.status.replace("_", " ")}</span>
                  <span className="text-[11px] text-muted-foreground">{r.dataset_name} — {r.rejected_count} rejected</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Theme">{resolved === "dark" ? <Moon className="size-4" /> : <Sun className="size-4" />}</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {([["light", Sun], ["dark", Moon], ["system", Monitor]] as const).map(([t, I]) => (
                <DropdownMenuItem key={t} onClick={() => setTheme(t)} className={cn("capitalize", theme === t && "font-semibold")}><I className="size-4" />{t}</DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" className="hidden h-9 rounded-full px-4 sm:inline-flex" onClick={() => setRunOpen(true)}><Play className="size-3.5" />Run pipeline</Button>
        </header>
        <main key={path} className="page-enter relative mx-auto w-full max-w-[1400px] flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
      <RunPipelineDialog open={runOpen} onOpenChange={setRunOpen} />
    </div>
  );
}
