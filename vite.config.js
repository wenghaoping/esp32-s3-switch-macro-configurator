import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  root: "web",
  // The firmware serves its bundle at `/`, while GitHub Pages serves this
  // project below `/<repository>/`. The deployment workflow supplies the
  // latter without changing the artifact embedded into Flash.
  base: process.env.VITE_BASE_PATH || "/",
  plugins: [vue()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./web/src", import.meta.url)) },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
