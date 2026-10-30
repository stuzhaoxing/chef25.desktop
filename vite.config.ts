import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  optimizeDeps: { entries: ["index.html"] },
  server: {
    host: "127.0.0.1",
    port: 25251,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  preview: { host: "127.0.0.1", port: 25253, strictPort: true },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
});
