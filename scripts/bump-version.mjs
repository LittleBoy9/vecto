#!/usr/bin/env node
/**
 * Bump the version in every place it is declared, in one step.
 *
 * The release workflow triggers on the version in tauri.conf.json changing, so
 * these three files drifting apart is not cosmetic — package.json and
 * Cargo.toml would ship a different number than the release is tagged with.
 *
 *   node scripts/bump-version.mjs patch|minor|major|<explicit version>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const TAURI = "src-tauri/tauri.conf.json";
const PKG = "package.json";
const CARGO = "src-tauri/Cargo.toml";
const LOCK = "src-tauri/Cargo.lock";

const arg = process.argv[2];
if (!arg) {
  console.error("usage: node scripts/bump-version.mjs patch|minor|major|<x.y.z>");
  process.exit(1);
}

const conf = JSON.parse(readFileSync(TAURI, "utf8"));
const current = conf.version;

function next(from, kind) {
  if (/^\d+\.\d+\.\d+$/.test(kind)) return kind;
  const [ma, mi, pa] = from.split(".").map(Number);
  if (kind === "major") return `${ma + 1}.0.0`;
  if (kind === "minor") return `${ma}.${mi + 1}.0`;
  if (kind === "patch") return `${ma}.${mi}.${pa + 1}`;
  console.error(`unknown bump: ${kind}`);
  process.exit(1);
}

const version = next(current, arg);
if (version === current) {
  console.error(`already at ${version} — nothing to do`);
  process.exit(1);
}

// tauri.conf.json — the source of truth the release workflow reads.
conf.version = version;
writeFileSync(TAURI, JSON.stringify(conf, null, 2) + "\n");

// package.json
const pkg = JSON.parse(readFileSync(PKG, "utf8"));
pkg.version = version;
writeFileSync(PKG, JSON.stringify(pkg, null, 2) + "\n");

// Cargo.toml — only the [package] version, never a dependency's.
const cargo = readFileSync(CARGO, "utf8");
const bumped = cargo.replace(
  /(\[package\][\s\S]*?\nversion\s*=\s*")[^"]+(")/,
  `$1${version}$2`
);
if (bumped === cargo) {
  console.error("could not find [package] version in Cargo.toml");
  process.exit(1);
}
writeFileSync(CARGO, bumped);

// Keep Cargo.lock in step so CI's --locked build does not fail.
try {
  execSync("cargo update --workspace --offline", { cwd: "src-tauri", stdio: "ignore" });
} catch {
  try {
    execSync("cargo update --workspace", { cwd: "src-tauri", stdio: "ignore" });
  } catch {
    console.warn(`! could not refresh ${LOCK} — run 'cargo check' in src-tauri before pushing`);
  }
}

console.log(`${current} → ${version}`);
console.log("");
console.log("  next:  git add -A");
console.log(`         git commit -m "release: v${version}"`);
console.log("         git push origin main");
console.log("");
console.log("  CI tags, builds all four platforms, and publishes automatically.");
