// Verify that changed files stay inside agent lanes (docs/agents/ownership.json, BUILD_PLAN §8).
//
//   node scripts/check-ownership.mjs          # list every changed file with its owner(s);
//                                             # violation = a file no agent owns (I's "**" ignored)
//   node scripts/check-ownership.mjs <agent>  # violation = a changed file outside <agent>'s globs
//
// "Changed" = `git status --porcelain -uall` (modified, added, deleted, renamed, untracked).
// Exit 1 on any violation.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const ownership = JSON.parse(readFileSync(join(root, "docs", "agents", "ownership.json"), "utf8"));
const agents = Object.keys(ownership).filter((k) => !k.startsWith("_"));
const CATCH_ALL = new Set(["I"]); // integrator owns everything; ignored for "owned by nobody"

/** Minimal glob → RegExp: `**` any depth, `*` one segment, `?` one char, `{a,b}` alternatives. */
function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        const slashAfter = glob[i + 2] === "/";
        re += slashAfter ? "(?:.*/)?" : ".*";
        i += slashAfter ? 2 : 1;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") re += "[^/]";
    else if (c === "{") {
      const end = glob.indexOf("}", i);
      const alts = glob.slice(i + 1, end).split(",").map((a) => a.replace(/[.+^$()|[\]\\]/g, "\\$&"));
      re += `(?:${alts.join("|")})`;
      i = end;
    } else re += c.replace(/[.+^$()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

const matchers = Object.fromEntries(agents.map((a) => [a, ownership[a].map(globToRegExp)]));
const ownersOf = (file) => agents.filter((a) => matchers[a].some((re) => re.test(file)));

function changedFiles() {
  const out = execFileSync("git", ["status", "--porcelain", "-uall"], { cwd: root, encoding: "utf8" });
  const files = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    let path = line.slice(3);
    if (path.includes(" -> ")) path = path.split(" -> ")[1]; // rename: check the new path
    path = path.replace(/^"(.*)"$/, "$1");
    files.push({ status: line.slice(0, 2), path });
  }
  return files;
}

const agent = process.argv[2];
if (agent && !agents.includes(agent)) {
  console.error(`Unknown agent "${agent}". Known: ${agents.join(", ")}`);
  process.exit(2);
}

const files = changedFiles();
if (files.length === 0) {
  console.log("No changed files.");
  process.exit(0);
}

let violations = 0;
for (const { status, path } of files) {
  const owners = ownersOf(path);
  const named = owners.filter((o) => !CATCH_ALL.has(o));
  let flag = "";
  if (agent) {
    if (!owners.includes(agent)) flag = `  <-- VIOLATION: outside ${agent}`;
  } else if (named.length === 0) {
    flag = "  <-- VIOLATION: owned by nobody";
  }
  if (flag) violations++;
  console.log(`${status} ${path}  [${named.join(", ") || "-"}]${flag}`);
}

console.log(
  violations
    ? `\n${violations} violation(s).`
    : `\nOK: ${files.length} changed file(s), all within ${agent ? `agent ${agent}'s lane` : "owned lanes"}.`,
);
process.exit(violations ? 1 : 0);
