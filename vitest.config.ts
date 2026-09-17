import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // The app itself always uses the automatic JSX runtime (no .tsx file
  // anywhere imports React explicitly — Next's own compiler handles that).
  // Vite/esbuild's default transform doesn't pick that up from tsconfig's
  // "jsx": "preserve" on its own, so a .tsx file pulled into a test without
  // this fails at render time with "React is not defined" — this was never
  // hit before pdf-state-breakdown.test.ts became the first test to import
  // a .tsx file directly.
  esbuild: {
    jsx: "automatic",
  },
});
