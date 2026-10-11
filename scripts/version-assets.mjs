// Stamp a deploy id onto the shell URLs Cloudflare caches for hours.
// Query strings stay on stable paths so a browser still holding the
// previous HTML cannot 404 a filename that this deploy deleted.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function version() {
  const fromEnv = process.env.GITHUB_SHA?.trim();
  const raw = fromEnv || execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const sha = raw.slice(0, 12).toLowerCase();
  if (!/^[0-9a-f]{12}$/.test(sha)) {
    throw new Error(`Asset version must be 12 hex characters, got ${JSON.stringify(raw)}`);
  }
  return sha;
}

function rewrite(pending, file, pattern, replacement) {
  const current = pending.get(file) ?? readFileSync(join(root, file), "utf8");
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const matches = current.match(new RegExp(pattern.source, flags));
  if (!matches || matches.length !== 1) {
    throw new Error(`${file}: expected exactly one match of ${pattern}, found ${matches?.length ?? 0}`);
  }
  pending.set(file, current.replace(pattern, replacement));
}

const sha = version();
const query = `?v=${sha}`;
const pending = new Map();

rewrite(pending, "public/index.html", /href="\/styles\.css"/, `href="/styles.css${query}"`);
rewrite(pending, "public/index.html", /src="\/app\.js"/, `src="/app.js${query}"`);
rewrite(pending, "public/app.js", /register\("\/sw\.js"\)/, `register("/sw.js${query}")`);
rewrite(pending, "public/sw.js", /const CACHE = "twinweather-[^"]+"/, `const CACHE = "twinweather-${sha}"`);
rewrite(pending, "public/sw.js", /"\/styles\.css"/, `"/styles.css${query}"`);
rewrite(pending, "public/sw.js", /"\/app\.js"/, `"/app.js${query}"`);

for (const [file, text] of pending) {
  writeFileSync(join(root, file), text);
}

console.log(`Stamped shell assets with v=${sha}`);
for (const file of pending.keys()) console.log(`  ${file}`);
