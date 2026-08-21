# Releasing Vecto

Shipping a release is one command and one push. Everything after that is automated.

```bash
npm run release:patch      # or release:minor / release:major
git add -A
git commit -m "release: v0.1.1"
git push origin main
```

CI tags the commit, builds four installers, merges the update manifest, publishes
the release, and verifies the live updater endpoint. Existing installs offer the
update the next time they launch.

---

## How the trigger works

The trigger is the **version in `src-tauri/tauri.conf.json`**, not the push
itself — otherwise every typo fix would become a user-facing update.

| You push | What happens |
|---|---|
| Version unchanged | Tests run. Nothing ships. |
| Version bumped | Tag → build ×4 → merge manifest → publish |

`npm run release:*` bumps `tauri.conf.json`, `package.json` and `Cargo.toml`
together. The gate job **fails the build if they disagree**, so a hand-edited
version can't ship a binary stamped differently from its own tag.

To re-run a release for a version that already has a tag, use the **Run workflow**
button on the Release workflow with `force` checked.

---

## The three phases

The pipeline is deliberately split, because the obvious design is broken.

When every matrix job publishes to the release independently, each one generates
its own `latest.json` and they race to upload it to the same tag. The last writer
wins and the other platforms vanish from the manifest. That is why a release can
end up with installers attached but an updater endpoint that 404s.

1. **Gate** — runs typecheck, tests and build. Decides whether the version
   changed. Creates the tag and **one** draft release.
2. **Build** — four parallel jobs upload installers into that draft *by id*. No
   job creates a release, and no job writes the manifest. Each records only its
   own platform entry as a workflow artifact.
3. **Publish** — runs only if **all four** builds succeeded. Merges the four
   entries into one `latest.json`, uploads it, flips the draft to published, then
   re-fetches the live endpoint and asserts every platform key is present.

Because publishing happens last, a half-release is impossible: a Windows user can
never be offered an update whose Windows binary failed to build.

---

## Required secrets

Set these under **Settings → Secrets and variables → Actions**.

### Update signing — required

Without these no `.sig` files are produced, and the updater rejects every
download. The build fails loudly rather than shipping a broken release.

| Secret | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Contents of the private key file |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | The key's passphrase (empty string if none) |

The keypair was generated to `~/.vecto/updater.key`. Copy the private half in
with:

```bash
pbcopy < ~/.vecto/updater.key
```

The **public** half is already committed in `tauri.conf.json` under
`plugins.updater.pubkey` — that one is not a secret.

> Back up `~/.vecto/updater.key`. Losing it means existing installs can no longer
> verify updates, and every user has to reinstall by hand. It is not recoverable.

### OS code signing — optional, but read this

The workflow already passes these through. They are picked up automatically the
moment they exist, with no workflow change.

| Secret | Purpose |
|---|---|
| `APPLE_CERTIFICATE` | Base64 of the Developer ID `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | Its password |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Name (TEAMID)` |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | Notarization |

**Until the Apple secrets exist, macOS auto-update does not work.** This is not
cosmetic. An unsigned, un-notarized `.dmg` downloaded from the internet is refused
by Gatekeeper — users typically see *"Vecto is damaged and can't be opened"* — and
Tauri's updater replaces the `.app` in place, which macOS rejects when the
replacement is not signed with a consistent identity. So the tap-to-update flow
fails on macOS specifically.

A Developer ID costs $99/year. Windows is more forgiving: an unsigned build shows
a SmartScreen warning the user can click past, so it is annoying but functional.

---

## What gets built

| Platform | Rust target | Installer | Updater key |
|---|---|---|---|
| macOS Apple Silicon | `aarch64-apple-darwin` | `.dmg` | `darwin-aarch64` |
| macOS Intel | `x86_64-apple-darwin` | `.dmg` | `darwin-x86_64` |
| Windows 64-bit | `x86_64-pc-windows-msvc` | `.exe` + `.msi` | `windows-x86_64` |
| Windows 32-bit | `i686-pc-windows-msvc` | `.exe` + `.msi` | `windows-i686` |

Windows updates install from the NSIS `-setup.exe`, which Tauri prefers over the
`.msi` for in-place updates. `record-update-entry.mjs` encodes that preference.

To add Windows on ARM — worth considering, since it is now more common than
32-bit x86 — add one matrix entry with target `aarch64-pc-windows-msvc` and key
`windows-aarch64`, and add that key to `REQUIRED` in `verify-manifest.mjs`.

---

## The in-app update

`src/lib/updater.ts` and `src/components/ui/UpdateBanner.tsx`.

Consent first, in both directions:

- The probe runs 4s after launch, off the startup path, and is **silent on
  failure** — offline and dev mode must never surface as an app error.
- Nothing downloads until the user taps **Update**.
- Download shows real byte progress, not an indeterminate spinner.
- Restarting with unsaved artwork asks a second time, and writes the crash-recovery
  snapshot first so the work survives the relaunch either way.
- **Later** means later — that version is not offered again for the session.
- Settings has a manual check, which reports "up to date" rather than staying quiet.

---

## If a release fails

The release stays a **draft** and the updater endpoint is untouched, so users are
never offered a broken update. Fix the cause and re-run with `force`.

- **"No .sig files were produced"** — `TAURI_SIGNING_PRIVATE_KEY` is missing or wrong.
- **"Version mismatch"** — the three version fields disagree. Use `npm run release:*`.
- **"missing platform X"** — that build job failed. Check its log; the release did
  not publish.
- **"Updater endpoint returned 404"** — the manifest did not upload. The release is
  published but incomplete; re-run the publish job.
