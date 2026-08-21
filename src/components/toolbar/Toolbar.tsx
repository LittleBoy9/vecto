import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { ExportMenu } from "./ExportMenu";
import { cn, basename } from "../../lib/utils";
import { parseSVG } from "../../lib/svgParser";
import { serializeDocument } from "../../lib/svgSerializer";
import { useDocumentStore } from "../../store/documentStore";
import { useSelectionStore } from "../../store/selectionStore";
import { useUIStore, type Tool } from "../../store/uiStore";
import { startNodeEditForSelectedPath } from "../../store/pathEditStore";
import { useSettingsStore, activeKey } from "../../store/settingsStore";
import { useThemeStore } from "../../store/themeStore";
import { useRecentStore } from "../../store/recentStore";
import { useContextMenuStore } from "../../store/contextMenuStore";
import { setFileController } from "../../lib/fileController";

// ── Tool button ───────────────────────────────────────────────────────────────

interface ToolButtonProps {
  tool: Tool;
  label: string;
  shortcut: string;
  icon: string;
  active: boolean;
  onClick: () => void;
}

function ToolButton({ label, shortcut, icon, active, onClick }: ToolButtonProps) {
  return (
    <button
      title={`${label} (${shortcut})`}
      onClick={onClick}
      className={cn(
        "flex items-center justify-center w-7 h-7 rounded text-sm transition-colors",
        active
          ? "bg-accent text-white"
          : "text-text-secondary hover:text-text-primary hover:bg-surface"
      )}
    >
      {icon}
    </button>
  );
}

// ── Separator ────────────────────────────────────────────────────────────────

function Sep() {
  return <div className="w-px h-4 bg-border mx-1" />;
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

export function Toolbar() {
  const exportBtnRef = useRef<HTMLButtonElement>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const activeTool = useUIStore((s) => s.activeTool);
  const setTool = useUIStore((s) => s.setTool);
  const setFileLoading = useUIStore((s) => s.setFileLoading);
  const { document: doc, isDirty, filePath, setDocument, setFilePath, markClean } =
    useDocumentStore();
  const clearSelection = useSelectionStore((s) => s.clearSelection);
  const settingsState = useSettingsStore();
  const { openSettings } = settingsState;
  const apiKey = activeKey(settingsState);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const recentPaths = useRecentStore((s) => s.paths);
  const addRecent = useRecentStore((s) => s.addRecent);
  const canUndo = useStore(useDocumentStore.temporal, (s) => s.pastStates.length > 0);
  const canRedo = useStore(useDocumentStore.temporal, (s) => s.futureStates.length > 0);

  // ── File actions ────────────────────────────────────────────────────────────

  const openPath = async (path: string) => {
    setFileLoading(true);
    clearSelection();
    try {
      const content = await invoke<string>("open_svg_file", { path });
      setDocument(parseSVG(content), path);
      addRecent(path);
    } catch (err) {
      console.error("Failed to open file:", err);
    } finally {
      setFileLoading(false);
    }
  };

  const handleOpen = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "SVG Files", extensions: ["svg"] }],
    });
    if (!selected || typeof selected !== "string") return;
    openPath(selected);
  };

  const handleRecent = (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const items = recentPaths.length
      ? recentPaths.map((p) => ({ label: basename(p), onClick: () => openPath(p) }))
      : [{ label: "No recent files", disabled: true }];
    useContextMenuStore.getState().openMenu(r.left, r.bottom + 4, items);
  };

  const handleTraceImage = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"] }],
    });
    if (!selected || typeof selected !== "string") return;

    setFileLoading(true);
    clearSelection();
    try {
      const svg = await invoke<string>("trace_image", { inputPath: selected });
      setDocument(parseSVG(svg));
    } catch (err) {
      console.error("Image trace failed:", err);
    } finally {
      setFileLoading(false);
    }
  };

  const handleSave = async () => {
    if (!doc) return;
    let targetPath = filePath;

    if (!targetPath) {
      targetPath = await save({
        filters: [{ name: "SVG Files", extensions: ["svg"] }],
        defaultPath: "untitled.svg",
      });
    }
    if (!targetPath) return;

    try {
      const content = serializeDocument(doc);
      await invoke("save_svg_file", { path: targetPath, content });
      setFilePath(targetPath);
      markClean();
      addRecent(targetPath);
    } catch (err) {
      console.error("Failed to save file:", err);
    }
  };

  const handleCopySvg = async () => {
    if (!doc) return;
    const content = serializeDocument(doc);
    try {
      await navigator.clipboard.writeText(content);
    } catch (err) {
      console.error("Clipboard write failed:", err);
    }
  };

  const handleSaveAs = async () => {
    if (!doc) return;
    const targetPath = await save({
      filters: [{ name: "SVG Files", extensions: ["svg"] }],
      defaultPath: filePath ?? "untitled.svg",
    });
    if (!targetPath) return;

    try {
      const content = serializeDocument(doc);
      await invoke("save_svg_file", { path: targetPath, content });
      setFilePath(targetPath);
      markClean();
      addRecent(targetPath);
    } catch (err) {
      console.error("Failed to save file:", err);
    }
  };

  // Expose file actions to the global keyboard hook (⌘O / ⌘S / ⌘⇧S).
  useEffect(() => {
    setFileController({ open: handleOpen, save: handleSave, saveAs: handleSaveAs });
    return () => setFileController(null);
  });

  // ── Undo / Redo ─────────────────────────────────────────────────────────────

  const handleUndo = () => useDocumentStore.temporal.getState().undo();
  const handleRedo = () => useDocumentStore.temporal.getState().redo();

  // ── Render ──────────────────────────────────────────────────────────────────

  const fileName = filePath
    ? basename(filePath)
    : doc
    ? "Untitled"
    : null;

  return (
    <header className="flex items-center gap-2 px-3 h-10 bg-panel border-b border-border flex-shrink-0 z-10">
      {/* Logo */}
      <span className="text-text-primary font-bold text-sm tracking-widest mr-1">
        VECTO
      </span>

      <Sep />

      {/* Tools */}
      <ToolButton
        tool="select"
        label="Select"
        shortcut="V"
        icon="↖"
        active={activeTool === "select"}
        onClick={() => setTool("select")}
      />
      <ToolButton
        tool="pan"
        label="Pan"
        shortcut="H"
        icon="✋"
        active={activeTool === "pan"}
        onClick={() => setTool("pan")}
      />
      <ToolButton
        tool="nodeEdit"
        label="Node Edit"
        shortcut="N"
        icon="◈"
        active={activeTool === "nodeEdit"}
        onClick={() => { setTool("nodeEdit"); startNodeEditForSelectedPath(); }}
      />

      <Sep />

      {/* Drawing tools */}
      <ToolButton
        tool="rect"
        label="Rectangle"
        shortcut="R"
        icon="▭"
        active={activeTool === "rect"}
        onClick={() => setTool("rect")}
      />
      <ToolButton
        tool="ellipse"
        label="Ellipse"
        shortcut="E"
        icon="◯"
        active={activeTool === "ellipse"}
        onClick={() => setTool("ellipse")}
      />
      <ToolButton
        tool="line"
        label="Line"
        shortcut="L"
        icon="╱"
        active={activeTool === "line"}
        onClick={() => setTool("line")}
      />
      <ToolButton
        tool="pen"
        label="Pen"
        shortcut="P"
        icon="✒"
        active={activeTool === "pen"}
        onClick={() => setTool("pen")}
      />
      <ToolButton
        tool="text"
        label="Text"
        shortcut="T"
        icon="T"
        active={activeTool === "text"}
        onClick={() => setTool("text")}
      />

      <Sep />

      {/* Undo / Redo */}
      <button
        title="Undo (⌘Z)"
        onClick={handleUndo}
        disabled={!canUndo}
        className="text-text-secondary hover:text-text-primary text-xs px-1.5 py-1 rounded hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
      >
        ↩
      </button>
      <button
        title="Redo (⌘⇧Z)"
        onClick={handleRedo}
        disabled={!canRedo}
        className="text-text-secondary hover:text-text-primary text-xs px-1.5 py-1 rounded hover:bg-surface disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
      >
        ↪
      </button>

      {/* File name */}
      {fileName && (
        <>
          <Sep />
          <span className="text-text-secondary text-xs truncate max-w-48">
            {fileName}
            {isDirty && (
              <span className="text-accent ml-1" title="Unsaved changes">
                •
              </span>
            )}
          </span>
        </>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* File actions */}
      <button
        onClick={handleOpen}
        className="text-text-secondary hover:text-text-primary text-xs px-2 py-1 rounded hover:bg-surface"
      >
        Open
      </button>
      <button
        onClick={handleRecent}
        title="Recent files"
        className="text-text-secondary hover:text-text-primary text-xs px-1.5 py-1 rounded hover:bg-surface"
      >
        ▾
      </button>
      <button
        onClick={handleTraceImage}
        title="Trace a raster image (PNG/JPG) into editable vectors"
        className="text-text-secondary hover:text-text-primary text-xs px-2 py-1 rounded hover:bg-surface"
      >
        Trace
      </button>
      <button
        onClick={handleSave}
        disabled={!doc}
        className="text-text-secondary hover:text-text-primary text-xs px-2 py-1 rounded hover:bg-surface disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Save{isDirty ? " *" : ""}
      </button>
      <button
        onClick={handleSaveAs}
        disabled={!doc}
        className="text-text-secondary hover:text-text-primary text-xs px-2 py-1 rounded hover:bg-surface disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Save As
      </button>

      <Sep />

      <button
        onClick={handleCopySvg}
        disabled={!doc}
        title="Copy SVG markup to clipboard"
        className="text-text-secondary hover:text-text-primary text-xs px-2 py-1 rounded hover:bg-surface disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Copy SVG
      </button>
      <button
        ref={exportBtnRef}
        onClick={() => setExportOpen((o) => !o)}
        disabled={!doc}
        title="Export as PNG / JPG (scale, selection)"
        className="text-text-secondary hover:text-text-primary text-xs px-2 py-1 rounded hover:bg-surface disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Export
      </button>
      {exportOpen && <ExportMenu anchor={exportBtnRef.current} onClose={() => setExportOpen(false)} />}

      <Sep />

      {/* Theme toggle */}
      <button
        onClick={toggleTheme}
        title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
        className="flex items-center justify-center w-7 h-7 rounded text-text-secondary hover:text-text-primary hover:bg-surface transition-colors"
      >
        {theme === "dark" ? "☀" : "☾"}
      </button>

      {/* Settings — shows a dot if API key is missing */}
      <button
        onClick={openSettings}
        title="Settings"
        className="relative flex items-center justify-center w-7 h-7 rounded text-text-secondary hover:text-text-primary hover:bg-surface transition-colors"
      >
        ⚙
        {!apiKey && (
          <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-accent rounded-full" />
        )}
      </button>
    </header>
  );
}
