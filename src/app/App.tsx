import { Toolbar } from "../components/toolbar/Toolbar";
import { LayerPanel } from "../components/sidebar/LayerPanel";
import { PropertiesPanel } from "../components/sidebar/PropertiesPanel";
import { Canvas } from "../components/canvas/Canvas";
import { PromptBar } from "../components/prompt/PromptBar";
import { SettingsModal } from "../components/settings/SettingsModal";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { useUIStore } from "../store/uiStore";

export default function App() {
  useKeyboardShortcuts();

  const leftPanelOpen = useUIStore((s) => s.leftPanelOpen);
  const rightPanelOpen = useUIStore((s) => s.rightPanelOpen);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-canvas text-text-primary font-sans">
      {/* Top toolbar */}
      <Toolbar />

      {/* Main area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Layers panel */}
        {leftPanelOpen && <LayerPanel />}

        {/* Center: Canvas */}
        <Canvas />

        {/* Right: Properties panel */}
        {rightPanelOpen && <PropertiesPanel />}
      </div>

      {/* Bottom: AI prompt bar */}
      <PromptBar />

      {/* Settings modal (portal-like, rendered at root level) */}
      <SettingsModal />
    </div>
  );
}
