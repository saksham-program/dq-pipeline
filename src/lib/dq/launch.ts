import { autoResetAllowed } from "./workspace";

/** Injected by vite.config.ts: one value per dev-server start. Undefined outside Vite (e.g. unit tests). */
declare const __APP_LAUNCH_ID__: string | undefined;
export const APP_LAUNCH_ID: string | null = typeof __APP_LAUNCH_ID__ === "string" ? __APP_LAUNCH_ID__ : null;

/** True only under the Vite dev server, or when VITE_DEMO_AUTO_RESET=true is set explicitly. */
export const envAllowsAutoReset = () => autoResetAllowed({ DEV: import.meta.env.DEV, VITE_DEMO_AUTO_RESET: import.meta.env.VITE_DEMO_AUTO_RESET });
