import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { defineConfig } from "vitest/config";

// `npm run test`     → pure unit tests (src/**/*.test.ts, excluding *.int.test.ts). No DB, no env.
// `npm run test:int` → `vitest run --mode int`: only src/**/*.int.test.ts, with .env.local loaded
//                      (DATABASE_URL). Runs files serially because they share one database.
//                      Int tests may create rows only with the `TEST-` prefix and must clean up.

/** Parse .env.local with Node's built-in parser; empty object if the file is missing. */
function loadDotEnvLocal(): Record<string, string> {
  const path = fileURLToPath(new URL("./.env.local", import.meta.url));
  if (!existsSync(path)) return {};
  const parsed = parseEnv(readFileSync(path, "utf8"));
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed)) if (typeof v === "string") out[k] = v;
  return out;
}

export default defineConfig(({ mode }) => {
  const isInt = mode === "int";
  return {
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    test: {
      environment: "node",
      passWithNoTests: true,
      include: isInt ? ["src/**/*.int.test.ts"] : ["src/**/*.test.ts"],
      exclude: isInt ? ["**/node_modules/**"] : ["**/node_modules/**", "**/*.int.test.ts"],
      ...(isInt
        ? {
            env: loadDotEnvLocal(),
            fileParallelism: false,
            testTimeout: 30_000,
            hookTimeout: 30_000,
          }
        : {}),
    },
  };
});
