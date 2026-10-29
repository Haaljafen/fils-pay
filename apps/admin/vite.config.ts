import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // apps/web already owns 5173.
    // 5174 clashes with storybook on my machine — am
    port: 5174,
    // The api has no CORS handling, so proxy it same-origin in dev. Pair with
    // VITE_ADMIN_API_BASE_URL= (empty) in apps/admin/.env.local.
    proxy: { "/v1": "http://localhost:3000" },
  },
});
