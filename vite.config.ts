import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, loadEnv } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig(({ command, mode }) => {
  // Make .env values (including non-VITE_ ones such as SUPABASE_URL) available to
  // server-side code via process.env during dev and build. Real environment
  // variables take precedence over .env.
  const env = loadEnv(mode, process.cwd(), "");
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }

  // One id per dev-server start (this function runs once per start). The app compares it with the id stored in the
  // database to tell a genuinely new launch from a browser refresh or hot reload, which share the same id.
  const launchId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  return {
    define: { __APP_LAUNCH_ID__: JSON.stringify(launchId) },
    plugins: [
      tsConfigPaths(), // resolves the "@/..." alias from tsconfig.json
      tailwindcss(),
      tanstackStart({
        // Use src/server.ts (our SSR error wrapper) as the server entry.
        server: { entry: "server" },
      }),
      viteReact(),
      // Server bundle for production builds only. Set a deployment preset here if needed,
      // e.g. nitro({ preset: "node-server" }).
      ...(command === "build" ? [nitro()] : []),
    ],
    resolve: {
      dedupe: ["react", "react-dom", "@tanstack/react-router", "@tanstack/react-query"],
    },
  };
});
