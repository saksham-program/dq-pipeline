import type React from "react";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type ThemePref = "light" | "dark" | "system";
export type DateRange = "7d" | "30d" | "90d" | "all";

interface Ctx {
  theme: ThemePref;
  setTheme: (t: ThemePref) => void;
  resolved: "light" | "dark";
  range: DateRange;
  setRange: (r: DateRange) => void;
}
// Keep one context instance across hot reloads: when this file is edited, already-mounted
// providers and freshly reloaded pages must still share the same context object.
const g = globalThis as unknown as { __dqAppCtx?: React.Context<Ctx | null> };
const AppCtx = g.__dqAppCtx ?? (g.__dqAppCtx = createContext<Ctx | null>(null));

/** Inline in <head> so the correct theme class is set before first paint (no flash). */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('dq-theme')||'light';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePref>("light");
  const [resolved, setResolved] = useState<"light" | "dark">("light");
  const [range, setRangeState] = useState<DateRange>("30d");

  useEffect(() => {
    setThemeState((localStorage.getItem("dq-theme") as ThemePref) || "light");
    const r = localStorage.getItem("dq-range") as DateRange | null;
    if (r) setRangeState(r);
  }, []);

  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const d = theme === "dark" || (theme === "system" && mq.matches);
      document.documentElement.classList.toggle("dark", d);
      setResolved(d ? "dark" : "light");
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);

  const setTheme = useCallback((t: ThemePref) => {
    document.body.classList.add("theme-transition");
    setTimeout(() => document.body.classList.remove("theme-transition"), 250);
    localStorage.setItem("dq-theme", t);
    setThemeState(t);
  }, []);
  const setRange = useCallback((r: DateRange) => {
    localStorage.setItem("dq-range", r);
    setRangeState(r);
  }, []);

  return <AppCtx.Provider value={{ theme, setTheme, resolved, range, setRange }}>{children}</AppCtx.Provider>;
}

export function useAppState() {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useAppState outside provider");
  return c;
}

export function rangeStart(r: DateRange): number {
  return r === "all" ? 0 : Date.now() - Number(r.replace("d", "")) * 86400000;
}
export const RANGE_LABEL: Record<DateRange, string> = { "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days", all: "All time" };
