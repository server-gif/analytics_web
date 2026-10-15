// Runs as the Worker's [build] command (see wrangler.toml).
//
// Cloudflare's git build runs `npx wrangler deploy`, and wrangler executes this
// [build] command first (docs: it "will be run as part of ... npx wrangler deploy").
// It builds the React dashboard into ../frontend/dist so the [assets] directory
// actually exists in the CI checkout (dist/ is gitignored, so it is NOT in git).
//
// Skipped during `wrangler dev` (WRANGLER_COMMAND=dev) so local iteration stays
// fast - local dev serves the UI via the Vite dev server instead.
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

if (process.env.WRANGLER_COMMAND === "dev") {
  console.log("[build] wrangler dev -> skipping dashboard build (use the Vite dev server)");
  process.exit(0);
}

const here = dirname(fileURLToPath(import.meta.url));
const frontend = join(here, "..", "frontend");
console.log("[build] building dashboard ->", frontend);
// npm install (not ci) so it is forgiving of lock drift; postbuild copies the
// tracking snippet into dist so /analytics.js is served alongside the SPA.
execSync("npm install && npm run build", { cwd: frontend, stdio: "inherit" });
