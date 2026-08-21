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

console.log(`manifest ok — v${m.version}, ${Object.keys(m.platforms).length} platforms:`);
for (const k of Object.keys(m.platforms).sort()) console.log(`  ${k}`);
