/**
 * Application-level error reporting.
 *
 * Writes a structured diagnostic (message, stack, route and caller-supplied
 * context) to the console so production errors caught by React / TanStack
 * error boundaries stay debuggable. React does not rethrow boundary-caught
 * errors to `window.onerror`, so boundaries should call this explicitly.
 *
 * This is deliberately provider-neutral: no data leaves the browser. To forward
 * errors to a monitoring service, add it inside `reportError` behind explicit
 * configuration.
 */

export type ErrorReportContext = Record<string, unknown>;

const MAX_SERIALIZED_LENGTH = 2000;

// Loaders and server fns throw raw Responses and plain objects (a Supabase
// `{ message, code, details }`), which String() reduces to "[object ...]".
export function describeThrown(error: unknown): string {
  if (error instanceof Response) {
    return `Response ${error.status}${error.url ? ` at ${error.url}` : ""}`;
  }
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  const { message } = (error ?? {}) as { message?: unknown };
  if (typeof message === "string" && message.length > 0) return message;
  try {
    return JSON.stringify(error)?.slice(0, MAX_SERIALIZED_LENGTH) ?? String(error);
  } catch {
    return String(error);
  }
}

export function reportError(error: unknown, context: ErrorReportContext = {}): void {
  if (typeof window === "undefined") return;
  const stack = error instanceof Error ? error.stack : undefined;
  console.error("[dq-pipeline] Unhandled UI error", {
    message: describeThrown(error),
    ...(stack !== undefined && { stack }),
    route: window.location.pathname,
    ...context,
  });
}
