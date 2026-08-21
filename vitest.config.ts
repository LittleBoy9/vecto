import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // parseSVG uses DOMParser and the serializer round-trips through real DOM,
    // so the pure-logic core still needs a document to test against.
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
});
