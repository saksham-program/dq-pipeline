import { supabase as cloud } from "@/integrations/supabase/client";
import { createDemoStore, DemoQuery, type DemoStore, type DemoTable } from "./demo-store";

/**
 * Disposable local/preview data never reaches Cloud tables. Published sites
 * keep the existing persistent client. Explicit VITE_DQ_DEMO_RESET on/off
 * overrides mode, but even an accidental "on" cannot delete Cloud records.
 */
export function isDemoWorkspace(hostname: string, override?: string): boolean {
  if (override === "on") return true;
  if (override === "off") return false;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || /^id-preview--[a-z0-9-]+\.lovable\.app$/.test(hostname);
}

declare global {
  // Survives hot reloads / remounts, cleared by a full page load.
  var __dqWorkspaceInit: Promise<boolean> | undefined;
  var __dqDemoStore: DemoStore | undefined;
  var __dqWorkspaceMode: "demo" | "persistent" | undefined;
}

/** Resolves true when a reset happened. Runs at most once per page load. */
export function initWorkspace(): Promise<boolean> {
  const existing = globalThis.__dqWorkspaceInit;
  if (existing && globalThis.__dqWorkspaceMode) return existing;
  const demo = isDemoWorkspace(window.location.hostname, import.meta.env["VITE_DQ_DEMO_RESET"] as string | undefined);
  globalThis.__dqWorkspaceMode = demo ? "demo" : "persistent";
  if (demo) globalThis.__dqDemoStore ??= createDemoStore();
  const initialized = Promise.resolve(demo);
  globalThis.__dqWorkspaceInit = initialized;
  return initialized;
}

/** The sole typed adapter boundary; DemoQuery covers DQ's tested query subset. */
export const workspaceClient = {
  from: ((table: DemoTable) => {
    if (globalThis.__dqWorkspaceMode === "demo") {
      const store = globalThis.__dqDemoStore;
      if (!store) throw new Error("Demo workspace has not initialized.");
      return new DemoQuery(store, table);
    }
    if (typeof window !== "undefined" && !globalThis.__dqWorkspaceMode) throw new Error("Workspace has not initialized.");
    return cloud.from(table);
  }) as typeof cloud.from,
};
