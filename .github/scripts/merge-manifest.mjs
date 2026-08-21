#!/usr/bin/env node
/**
 * Combine every platform fragment into the single latest.json the updater reads.
 *
 * Runs once, in a job that depends on all four builds, so this is the only
 * writer of the manifest in the whole pipeline.
 *
 *   node merge-manifest.mjs <entries-dir> <out-file>
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const [dir, out] = process.argv.slice(2);
if (!dir || !out) {
  console.error("usage: merge-manifest.mjs <entries-dir> <out-file>");
  process.exit(1);
}

const version = process.env.VERSION;
if (!version) {
  console.error("::error::VERSION is not set");
  process.exit(1);
}

/** download-artifact nests each artifact in its own directory. */
function findEntries(root) {
  const found = [];
  for (const name of readdirSync(root)) {
    const p = join(root, name);
    if (statSync(p).isDirectory()) found.push(...findEntries(p));
    else if (name === "update-entry.json") found.push(p);
  }
  return found;
}

const files = findEntries(dir);
if (files.length === 0) {
  console.error(`::error::No update-entry.json found under ${dir}`);
  process.exit(1);
}

const platforms = {};
for (const f of files) {
  const e = JSON.parse(readFileSync(f, "utf8"));
  if (!e.platform || !e.signature || !e.url) {
    console.error(`::error::${f} is missing platform, signature or url`);
    process.exit(1);
  }
  if (platforms[e.platform]) {
    console.error(`::error::Duplicate entry for ${e.platform} — two jobs claimed the same platform`);
    process.exit(1);
  }
  platforms[e.platform] = { signature: e.signature, url: e.url };
}

const manifest = {
  version,
  notes: `Vecto ${version}. See the release notes at https://github.com/${process.env.GITHUB_REPOSITORY ?? "LittleBoy9/vecto"}/releases/tag/v${version}`,
  pub_date: new Date().toISOString(),
  platforms,
};

writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");
console.log(`merged ${files.length} entries → ${out}`);
for (const k of Object.keys(platforms).sort()) console.log(`  ${k}`);
