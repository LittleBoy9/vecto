#!/usr/bin/env node
/**
 * Record THIS platform's updater entry, and nothing else.
 *
 * Every build job writes only its own fragment; `merge-manifest.mjs` combines
 * them in a single later job. That is the whole fix for the race that leaves
 * both reference pipelines with a partial or missing latest.json — when four
 * matrix jobs each generate and upload a full manifest to the same release,
 * the last writer wins and three platforms silently disappear.
 *
 * Env: ARTIFACTS (JSON array from tauri-action), PLATFORM_KEY, TAG, REPO
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const { ARTIFACTS, PLATFORM_KEY, TAG, REPO } = process.env;

for (const [k, v] of Object.entries({ ARTIFACTS, PLATFORM_KEY, TAG, REPO })) {
  if (!v) {
    console.error(`::error::${k} is not set`);
    process.exit(1);
  }
}

let paths;
try {
  paths = JSON.parse(ARTIFACTS);
} catch {
  console.error(`::error::Could not parse artifactPaths: ${ARTIFACTS}`);
  process.exit(1);
}

const sigs = paths.filter((p) => p.endsWith(".sig"));
if (sigs.length === 0) {
  // Almost always a missing signing key. Failing here is the point: shipping a
  // release whose artifacts have no signatures produces an updater that rejects
  // every download, which is far harder to notice later.
  console.error(
    "::error::No .sig files were produced. TAURI_SIGNING_PRIVATE_KEY is probably " +
      "missing or wrong — without it the auto-updater cannot verify any download."
  );
  console.error(`artifacts seen:\n  ${paths.join("\n  ") || "(none)"}`);
  process.exit(1);
}

/**
 * Pick the artifact the updater should actually download.
 * macOS updates from the .app.tar.gz; Windows from the NSIS installer, which
 * Tauri prefers over the .msi for in-place updates.
 */
function pick(list) {
  const byPreference = [
    (p) => p.endsWith(".app.tar.gz.sig"),
    (p) => p.endsWith("-setup.exe.sig"),
    (p) => p.endsWith(".nsis.zip.sig"),
    (p) => p.endsWith(".msi.sig"),
  ];
  for (const matches of byPreference) {
    const hit = list.find(matches);
    if (hit) return hit;
  }
  return list[0];
}

const sigPath = pick(sigs);
const payloadName = basename(sigPath).replace(/\.sig$/, "");
const signature = readFileSync(sigPath, "utf8").trim();

if (!signature) {
  console.error(`::error::${sigPath} is empty — the artifact was not signed.`);
  process.exit(1);
}

const entry = {
  platform: PLATFORM_KEY,
  signature,
  // The LOCAL bundle name, which is not necessarily the asset name. On macOS
  // tauri-action renames the updater bundle on upload — Vecto.app.tar.gz becomes
  // Vecto_aarch64.app.tar.gz / Vecto_x64.app.tar.gz — so that the two macOS
  // builds do not collide as assets on the same release. Deriving the download
  // URL from this name produced a manifest whose macOS entries 404'd.
  // The publish job resolves the real asset name; see merge-manifest.mjs.
  localName: payloadName,
};

writeFileSync("update-entry.json", JSON.stringify(entry, null, 2) + "\n");

console.log(`platform  : ${entry.platform}`);
console.log(`local name: ${payloadName}`);
console.log(`signature : ${signature.length} chars`);
