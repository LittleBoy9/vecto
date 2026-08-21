#!/usr/bin/env node
/**
 * Combine every platform fragment into the single latest.json the updater reads,
 * resolving each entry to the asset name the release ACTUALLY has.
 *
 * Runs once, in a job that depends on all four builds, so this is the only
 * writer of the manifest in the whole pipeline.
 *
 * Why the resolution step exists: the local bundle name is not always the asset
 * name. tauri-action renames the macOS updater bundle on upload so the two macOS
 * builds do not collide — Vecto.app.tar.gz becomes Vecto_aarch64.app.tar.gz and
 * Vecto_x64.app.tar.gz. Building the URL from the local name shipped a manifest
 * whose macOS entries 404'd while Windows worked, because Windows bundle names
 * already carry the architecture and are not renamed.
 *
 * Matching is done on SIGNATURE CONTENT rather than filename, so it stays
 * correct regardless of how any bundler chooses to name things.
 *
 *   node merge-manifest.mjs <entries-dir> <out-file> <sig-assets-dir>
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const [dir, out, sigDir] = process.argv.slice(2);
if (!dir || !out || !sigDir) {
  console.error("usage: merge-manifest.mjs <entries-dir> <out-file> <sig-assets-dir>");
  process.exit(1);
}

const version = process.env.VERSION;
const repo = process.env.GITHUB_REPOSITORY;
const tag = process.env.TAG;
for (const [k, v] of Object.entries({ VERSION: version, GITHUB_REPOSITORY: repo, TAG: tag })) {
  if (!v) {
    console.error(`::error::${k} is not set`);
    process.exit(1);
  }
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

// Every .sig asset that was uploaded to the release, keyed by its content.
const sigByContent = new Map();
for (const name of readdirSync(sigDir)) {
  if (!name.endsWith(".sig")) continue;
  const content = readFileSync(join(sigDir, name), "utf8").trim();
  sigByContent.set(content, name.replace(/\.sig$/, ""));
}
console.log(`release carries ${sigByContent.size} signature assets`);

const files = findEntries(dir);
if (files.length === 0) {
  console.error(`::error::No update-entry.json found under ${dir}`);
  process.exit(1);
}

const platforms = {};
for (const f of files) {
  const e = JSON.parse(readFileSync(f, "utf8"));
  if (!e.platform || !e.signature) {
    console.error(`::error::${f} is missing platform or signature`);
    process.exit(1);
  }
  if (platforms[e.platform]) {
    console.error(`::error::Duplicate entry for ${e.platform} — two jobs claimed the same platform`);
    process.exit(1);
  }

  // Resolve by signature, not by name.
  const assetName = sigByContent.get(e.signature.trim());
  if (!assetName) {
    console.error(
      `::error::No uploaded .sig on the release matches the signature recorded for ` +
        `"${e.platform}" (local bundle was ${e.localName ?? "unknown"}). The build ` +
        `artifact was probably never uploaded.`
    );
    process.exit(1);
  }
  if (e.localName && e.localName !== assetName) {
    console.log(`  ${e.platform}: ${e.localName} -> uploaded as ${assetName}`);
  }

  platforms[e.platform] = {
    signature: e.signature,
    url: `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(assetName)}`,
  };
}

const manifest = {
  version,
  notes: `Vecto ${version}. See the release notes at https://github.com/${repo}/releases/tag/${tag}`,
  pub_date: new Date().toISOString(),
  platforms,
};

writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");
console.log(`merged ${files.length} entries → ${out}`);
for (const k of Object.keys(platforms).sort()) {
  console.log(`  ${k}  ${platforms[k].url.split("/").pop()}`);
}
