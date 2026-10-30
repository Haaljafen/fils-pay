import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vite";
import base from "../apps/admin/vite.config";

// Audit-only: see vite.web.config.ts. Admin gets its own port.
export default mergeConfig(
  base,
  defineConfig({
    root: fileURLToPath(new URL("../apps/admin", import.meta.url)),
    // Empty base = same-origin requests, which the /v1 proxy above forwards.
    define: { "import.meta.env.VITE_ADMIN_API_BASE_URL": JSON.stringify("") },
    server: {
      port: 5181,
      strictPort: true,
      proxy: { "/v1": "http://127.0.0.1:3100" },
    },
  }),
);
