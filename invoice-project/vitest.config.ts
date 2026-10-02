import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: { include: ["test/**/*.test.ts"], environment: "node" },
  resolve: { alias: { "@": path.resolve(__dirname, "src"), "server-only": path.resolve(__dirname, "test/server-only-stub.ts") } },
});
