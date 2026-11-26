import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z.object({
  url: z.string().url().max(2000),
  method: z.enum(["GET", "POST"]),
  headers: z.record(z.string(), z.string()).default({}),
  body: z.string().max(100_000).optional(),
});

/** Server-side proxy so browser CORS rules don't block API ingestion. Returns the real response — never a simulated one. */
export const fetchApiSource = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }) => {
    const u = new URL(data.url);
    if (!["http:", "https:"].includes(u.protocol)) return { ok: false, status: 0, requiresAuth: false, error: "Only http(s) URLs are allowed.", jsonText: null as string | null, elapsedMs: 0 };
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(u.hostname)) return { ok: false, status: 0, requiresAuth: false, error: "Private network addresses are not allowed.", jsonText: null as string | null, elapsedMs: 0 };
    const t0 = Date.now();
    try {
      const res = await fetch(data.url, {
        method: data.method,
        headers: { Accept: "application/json", ...data.headers, ...(data.body ? { "Content-Type": "application/json" } : {}) },
        body: data.method === "POST" ? (data.body ?? null) : null,
        signal: AbortSignal.timeout(15000),
      });
      const text = await res.text();
      const elapsedMs = Date.now() - t0;
      const requiresAuth = res.status === 401 || res.status === 403;
      if (!res.ok) return { ok: false, status: res.status, requiresAuth, error: requiresAuth ? `HTTP ${res.status}: endpoint requires authentication.` : `HTTP ${res.status} ${res.statusText}`, jsonText: null as string | null, elapsedMs };
      if (text.length > 5_000_000) return { ok: false, status: res.status, requiresAuth, error: "Response is larger than 5 MB.", jsonText: null as string | null, elapsedMs };
      try {
        JSON.parse(text);
        return { ok: true, status: res.status, requiresAuth, error: null, jsonText: text as string | null, elapsedMs };
      } catch {
        return { ok: false, status: res.status, requiresAuth, error: "Response is not valid JSON.", jsonText: null as string | null, elapsedMs };
      }
    } catch (e) {
      return { ok: false, status: 0, requiresAuth: false, error: e instanceof Error ? e.message : "Request failed", jsonText: null as string | null, elapsedMs: Date.now() - t0 };
    }
  });
