/**
 * The merge gate, runnable locally: schema + limits for everything, then
 * verbatim quote checks for the content files changed against origin/main
 * (or the files given). Exit code 0 means the PR will pass CI.
 *   npm run gate                 # changed files vs origin/main
 *   npm run gate -- --all        # every quote and image checked strictly
 */
import { execSync } from "node:child_process";

const args = process.argv.slice(2);
const all = args.includes("--all");
let files = args.filter((a) => a.endsWith(".json"));
if (!files.length && !all) {
  const base = process.env.GATE_BASE ?? "origin/main";
  const out = execSync(`git diff --name-only --diff-filter=AM ${base} -- content/ ; git ls-files --others --exclude-standard content/`)
    .toString()
    .split("\n")
    .filter((f) => /^content\/(works|artists|tags)\/[A-Za-z0-9._-]+\.json$/.test(f));
  files = [...new Set(out)];
}

// The images of the files being changed are checked strictly; see validate.ts.
// With --all, GATE_CHANGED is left unset and every image is strict.
const env = all ? process.env : { ...process.env, GATE_CHANGED: files.join("\n") };
const run = (cmd: string) => execSync(cmd, { stdio: "inherit", env });
run("npx tsx scripts/validate.ts --images");
if (!files.length && !all) {
  console.log("no changed content files to verify");
  process.exit(0);
}
run(`npx tsx scripts/verify-quotes.ts ${files.join(" ")}`);
