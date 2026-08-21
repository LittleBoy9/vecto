import { useState } from "react";
import { useUpdateStore } from "../../store/updateStore";
import {
  downloadUpdate,
  hasUnsavedWork,
  installAndRestart,
} from "../../lib/updater";
import { cn } from "../../lib/utils";

/**
 * Top banner offering a downloaded-on-demand update.
 *
 * A banner rather than a modal: an update is never urgent enough to block
 * someone mid-drag. Nothing is downloaded until "Update" is pressed, and the
 * restart asks again when the document is dirty.
 */
export function UpdateBanner() {
  const { phase, version, notes, progress, error, dismiss } = useUpdateStore();
  const [confirmRestart, setConfirmRestart] = useState(false);

  if (phase === "idle") return null;

  // ── Downloading ───────────────────────────────────────────────────────────
  if (phase === "downloading") {
    const pct = progress === null ? null : Math.round(progress * 100);
    return (
      <Bar>
        <span className="flex-1">
          Downloading Vecto {version}
          {pct !== null && <span className="text-text-primary ml-1 tabular-nums">{pct}%</span>}
        </span>
        <div className="w-40 h-1 rounded-full bg-surface overflow-hidden flex-shrink-0">
          <div
            className={cn("h-full bg-accent transition-[width] duration-200", pct === null && "animate-pulse w-1/3")}
            style={pct === null ? undefined : { width: `${pct}%` }}
          />
        </div>
      </Bar>
    );
  }

  // ── Ready to restart ──────────────────────────────────────────────────────
  if (phase === "ready") {
    // Restarting over unsaved artwork is the one genuinely destructive moment
    // in this flow, so it gets an explicit second confirmation.
    if (confirmRestart && hasUnsavedWork()) {
      return (
        <Bar tone="warn">
          <span className="flex-1">
            You have unsaved changes. They'll be restored automatically after the
            restart, but saving first is safer.
          </span>
          <Action onClick={() => void installAndRestart()}>Restart anyway</Action>
          <Action subtle onClick={() => setConfirmRestart(false)}>Cancel</Action>
        </Bar>
      );
    }
    return (
      <Bar tone="ok">
        <span className="flex-1">Vecto {version} is ready to install.</span>
        <Action
          onClick={() => {
            if (hasUnsavedWork()) setConfirmRestart(true);
            else void installAndRestart();
          }}
        >
          Restart now
        </Action>
        <Action subtle onClick={dismiss}>Later</Action>
      </Bar>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (phase === "error") {
    return (
      <Bar tone="danger">
        <span className="flex-1">{error}</span>
        <Action subtle onClick={dismiss}>Dismiss</Action>
      </Bar>
    );
  }

  // ── Available ─────────────────────────────────────────────────────────────
  return (
    <Bar>
      <span className="flex-1">
        <span className="text-text-primary font-medium">Vecto {version}</span> is
        available.
        {notes && <span className="opacity-70"> {firstLine(notes)}</span>}
      </span>
      <Action onClick={() => void downloadUpdate()}>Update</Action>
      <Action subtle onClick={dismiss}>Later</Action>
    </Bar>
  );
}

// ── Presentation ────────────────────────────────────────────────────────────

function Bar({
  children,
  tone = "accent",
}: {
  children: React.ReactNode;
  tone?: "accent" | "ok" | "warn" | "danger";
}) {
  const tones = {
    accent: "bg-accent/10 border-accent/20",
    ok: "bg-accent/10 border-accent/20",
    warn: "bg-danger/10 border-danger/20",
    danger: "bg-danger/10 border-danger/20",
  };
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-1.5 text-[11px] border-b text-text-secondary flex-shrink-0",
        tones[tone]
      )}
    >
      <span className="text-accent flex-shrink-0">✦</span>
      {children}
    </div>
  );
}

function Action({
  children,
  onClick,
  subtle,
}: {
  children: React.ReactNode;
  onClick: () => void;
  subtle?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "underline flex-shrink-0 transition-colors",
        subtle ? "opacity-60 hover:opacity-100" : "text-accent hover:text-accent-hover"
      )}
    >
      {children}
    </button>
  );
}

/** Release notes are often multi-line markdown; the banner shows only a taste. */
function firstLine(notes: string): string {
  const line = notes.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  return line.length > 90 ? line.slice(0, 90) + "…" : line;
}
