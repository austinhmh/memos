import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@/": `${resolve(__dirname, "src")}/`,

      "@shared/editor/": `${resolve(__dirname, "src/outline-vendor/shared/editor")}/`,
      "@shared/": `${resolve(__dirname, "src/outline-shims/shared")}/`,

      "~/editor": `${resolve(__dirname, "src/outline-vendor/app/editor")}/`,
      "~/": `${resolve(__dirname, "src/outline-shims/app")}/`,
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
