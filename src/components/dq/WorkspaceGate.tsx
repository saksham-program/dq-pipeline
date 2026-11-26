import { useEffect, useState, type ReactNode } from "react";
import { initWorkspace } from "@/lib/dq/workspace";
import { BrandLogo } from "./BrandLogo";

/** Initialize before any page, header or run dialog can issue workspace reads. */
export function WorkspaceGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    initWorkspace().then(() => { if (live) setReady(true); });
    return () => { live = false; };
  }, []);
  if (!ready) return <div className="flex flex-col items-center gap-3 py-20 text-center"><BrandLogo /><p className="font-display font-bold">DQ Pipeline</p><p className="text-sm text-muted-foreground">Preparing workspace…</p></div>;
  return <>{children}</>;
}
