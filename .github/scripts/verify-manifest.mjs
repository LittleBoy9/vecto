#!/usr/bin/env node
/**
 * Assert the PUBLISHED manifest is complete, by fetching it back from the live
 * endpoint the app actually uses.
 *
 * This is the check that would have caught gitpulse shipping a release whose
 * updater endpoint 404s, and whose Intel macOS build silently produced nothing.
 *
 *   node verify-manifest.mjs <fetched-json> <expected-version>
 */
import { readFileSync } from "node:fs";

const [file, expectedVersion] = process.argv.slice(2);

const REQUIRED = ["darwin-aarch64", "darwin-x86_64", "windows-x86_64", "windows-i686"];

let m;
try {
  m = JSON.parse(readFileSync(file, "utf8"));
} catch (e) {
  console.error(`::error::Published manifest is not valid JSON: ${e.message}`);
  process.exit(1);
}

const problems = [];

if (m.version !== expectedVersion) {
  problems.push(`version is "${m.version}", expected "${expectedVersion}"`);
}

for (const key of REQUIRED) {
  const p = m.platforms?.[key];
  if (!p) { problems.push(`missing platform "${key}" — those users can never update`); continue; }
  if (!p.signature) problems.push(`"${key}" has no signature — the updater will reject it`);
  if (!p.url) problems.push(`"${key}" has no url`);
  else if (!p.url.startsWith("https://")) problems.push(`"${key}" url is not https`);
}

if (problems.length) {
  for (const p of problems) console.error(`::error::${p}`);
  process.exit(1);
}

// Shape alone is not enough. A manifest can name every platform, carry a valid
// signature for each, and still be useless because the download URL points at an
// asset that does not exist — which is exactly what shipped when the macOS URLs
// were derived from the local bundle name instead of the uploaded asset name.
// Every URL is fetched here so that failure can never reach a user silently.
console.log("checking every download URL resolves…");
const results = await Promise.all(
  Object.entries(m.platforms).map(async ([key, p]) => {
    try {
      const res = await fetch(p.url, { method: "HEAD", redirect: "follow" });
      return { key, url: p.url, status: res.status, ok: res.ok };
    } catch (e) {
      return { key, url: p.url, status: `network error: ${e.message}`, ok: false };
    }
  })
);

let broken = 0;
for (const r of results.sort((a, b) => a.key.localeCompare(b.key))) {
  const name = r.url.split("/").pop();
  if (r.ok) {
    console.log(`  ok   ${r.status}  ${r.key.padEnd(16)} ${name}`);
  } else {
    broken++;
    console.error(`::error::${r.key} download URL is not reachable (${r.status}): ${r.url}`);
  }
}
if (broken) {
  console.error(`::error::${broken} platform(s) have an unreachable download — those users cannot update.`);
  process.exit(1);
}

console.log(`manifest ok — v${m.version}, ${Object.keys(m.platforms).length} platforms, all downloads reachable.`);
