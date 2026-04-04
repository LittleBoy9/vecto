import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { cn } from "../../lib/utils";
import { parseSVG } from "../../lib/svgParser";
import { serializeDocument } from "../../lib/svgSerializer";
import { useDocumentStore } from "../../store/documentStore";
import { useSelectionStore } from "../../store/selectionStore";
import { useUIStore, type Tool } from "../../store/uiStore";
import { useSettingsStore } from "../../store/settingsStore";

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
  const activeTool = useUIStore((s) => s.activeTool);
  const setTool = useUIStore((s) => s.setTool);
  const setFileLoading = useUIStore((s) => s.setFileLoading);
  const { document: doc, isDirty, filePath, setDocument, setFilePath, markClean } =
    useDocumentStore();
  const clearSelection = useSelectionStore((s) => s.clearSelection);
  const { apiKey, openSettings } = useSettingsStore();

  // ── File actions ────────────────────────────────────────────────────────────

  const handleOpen = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "SVG Files", extensions: ["svg"] }],
    });
    if (!selected || typeof selected !== "string") return;

    setFileLoading(true);
    clearSelection();
    try {
      const content = await invoke<string>("open_svg_file", { path: selected });
      const parsed = parseSVG(content);
      setDocument(parsed, selected);
    } catch (err) {
      console.error("Failed to open file:", err);
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
    } catch (err) {
      console.error("Failed to save file:", err);
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
    } catch (err) {
      console.error("Failed to save file:", err);
    }
  };

  // ── Undo / Redo ─────────────────────────────────────────────────────────────

  const handleUndo = () => useDocumentStore.temporal.getState().undo();
  const handleRedo = () => useDocumentStore.temporal.getState().redo();

  // ── Render ──────────────────────────────────────────────────────────────────

  const fileName = filePath
    ? filePath.split("/").pop() ?? filePath
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

      <Sep />

      {/* Undo / Redo */}
      <button
        title="Undo (⌘Z)"
        onClick={handleUndo}
        className="text-text-secondary hover:text-text-primary text-xs px-1.5 py-1 rounded hover:bg-surface"
      >
        ↩
      </button>
      <button
        title="Redo (⌘⇧Z)"
        onClick={handleRedo}
        className="text-text-secondary hover:text-text-primary text-xs px-1.5 py-1 rounded hover:bg-surface"
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
