import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const frontendDirectory = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: frontendDirectory,
  base: "/",
});
