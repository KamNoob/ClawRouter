/**
 * Single source of truth for version.
 * Reads from package.json at build time via tsup's define.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Read package.json at runtime
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// In dist/, go up one level to find package.json
let version = "0.0.0";
try {
  const require = createRequire(import.meta.url);
  const pkg = require(join(__dirname, "..", "package.json")) as { version: string };
  version = pkg.version;
} catch {
  // Fallback if package.json is not found (e.g., bundled without it)
}

export const VERSION = version;
export const USER_AGENT = `clawrouter/${VERSION}`;
