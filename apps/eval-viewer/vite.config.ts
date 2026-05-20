import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    fs: {
      // Allow serving the symlinked results.jsonl that points outside the
      // project root (into apps/api/evals/extraction/).
      allow: [".", "../api"],
    },
  },
});
