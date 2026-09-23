import { defineConfig } from "vite";
import { siwoManifestPlugin } from "./scripts/siwo-manifest.js";

export default defineConfig({
  plugins: [siwoManifestPlugin()],
});
