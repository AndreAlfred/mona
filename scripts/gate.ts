/**
 * The merge gate, runnable locally: schema + limits for everything, then
 * verbatim quote checks for the content files changed against origin/main
 * (or the files given). Exit code 0 means the PR will pass CI.
 *   npm run gate                 # changed files vs origin/main
 *   npm run gate -- --all        # every quote in the repo
 */
import { execSync } from "node:child_process";

const run = (cmd: string) => execSync(cmd, { stdio: "inherit" });
const args = process.argv.slice(2);
run("npx tsx scripts/validate.ts --images");
let files = args.filter((a) => a.endsWith(".json"));
if (!files.length && !args.includes("--all")) {
  const base = process.env.GATE_BASE ?? "origin/main";
  const out = execSync(`git diff --name-only --diff-filter=AM ${base} -- content/ ; git ls-files --others --exclude-standard content/`)
    .toString()
    .split("\n")
    .filter((f) => /^content\/(works|artists|tags)\/.+\.json$/.test(f));
  files = [...new Set(out)];
  if (!files.length) {
    console.log("no changed content files to verify");
    process.exit(0);
  }
}
run(`npx tsx scripts/verify-quotes.ts ${files.join(" ")}`);
