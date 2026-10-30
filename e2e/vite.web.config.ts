import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vite";
import base from "../apps/web/vite.config";

// Audit-only: the app's own config proxies /v1 to :3000, which is the shared
// dev API. The e2e run needs its own API on :3100 bound to the scratch DB.
export default mergeConfig(
  base,
  defineConfig({
    root: fileURLToPath(new URL("../apps/web", import.meta.url)),
    // Empty base = same-origin requests, which the /v1 proxy above forwards.
    define: { "import.meta.env.VITE_API_BASE_URL": JSON.stringify("") },
    server: {
      port: 5180,
      strictPort: true,
      proxy: { "/v1": "http://127.0.0.1:3100" },
    },
  }),
);
