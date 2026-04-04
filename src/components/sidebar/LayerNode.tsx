import { useState } from "react";
import { cn, nodeIcon } from "../../lib/utils";
import type { VectoNode } from "../../types/svg";
import { useSelectionStore } from "../../store/selectionStore";
import { useDocumentStore } from "../../store/documentStore";

interface LayerNodeProps {
  node: VectoNode;
  depth: number;
}

export function LayerNode({ node, depth }: LayerNodeProps) {
  const [expanded, setExpanded] = useState(true);
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const select = useSelectionStore((s) => s.select);
  const addToSelection = useSelectionStore((s) => s.addToSelection);
  const setHovered = useSelectionStore((s) => s.setHovered);
  // Per-node selector — only this row re-renders when hover changes, not the whole panel
  const isHovered = useSelectionStore((s) => s.hoveredId === node.id);
  const toggleVisibility = useDocumentStore((s) => s.toggleNodeVisibility);
  const toggleLock = useDocumentStore((s) => s.toggleNodeLock);

  const isSelected = selectedIds.includes(node.id);
  const hasChildren = node.children.length > 0;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (e.shiftKey) {
      addToSelection(node.id);
    } else {
      select([node.id]);
    }
  };

  const handleToggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded((v) => !v);
  };

  const handleToggleVisibility = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleVisibility(node.id);
  };

  const handleToggleLock = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleLock(node.id);
  };

  return (
    <div className="w-full min-w-0">
      <div
        className={cn(
          "group flex items-center gap-1 py-[3px] pr-2 text-xs cursor-pointer rounded-sm mx-1 w-full min-w-0",
          "transition-colors duration-75",
          isSelected
            ? "bg-accent-dim text-accent"
            : isHovered
            ? "bg-surface text-text-primary"
            : "text-text-secondary hover:bg-surface hover:text-text-primary"
        )}
        style={{ paddingLeft: `${6 + depth * 14}px` }}
        onClick={handleClick}
        onMouseEnter={() => setHovered(node.id)}
        onMouseLeave={() => setHovered(null)}
      >
        {/* Expand / collapse toggle */}
        <button
          className="w-3 flex-shrink-0 text-center opacity-50"
          onClick={handleToggleExpand}
        >
          {hasChildren ? (expanded ? "▾" : "▸") : " "}
        </button>

        {/* Node type icon */}
        <span className="w-3 flex-shrink-0 text-center opacity-60 font-mono">
          {nodeIcon(node.tagName)}
        </span>

        {/* Name */}
        <span
          className={cn(
            "flex-1 truncate",
            !node.visible && "opacity-40 line-through"
          )}
        >
          {node.name}
        </span>

        {/* Hover actions */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            title={node.visible ? "Hide layer" : "Show layer"}
            onClick={handleToggleVisibility}
            className="w-4 h-4 flex items-center justify-center hover:text-text-primary rounded"
          >
            {node.visible ? (
              // Eye open
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path
                  d="M1 6.5C1 6.5 2.8 3 6.5 3C10.2 3 12 6.5 12 6.5C12 6.5 10.2 10 6.5 10C2.8 10 1 6.5 1 6.5Z"
                  stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round"
                />
                <circle cx="6.5" cy="6.5" r="1.5" stroke="currentColor" strokeWidth="1.1" />
              </svg>
            ) : (
              // Eye closed (strikethrough)
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path
                  d="M1.5 1.5L11.5 11.5"
                  stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"
                />
                <path
                  d="M5.2 3.2C5.6 3.07 6.04 3 6.5 3C10.2 3 12 6.5 12 6.5C11.6 7.27 11.07 7.96 10.43 8.53M7.83 7.83C7.48 8.16 7.01 8.37 6.5 8.37C5.4 8.37 4.5 7.47 4.5 6.37C4.5 5.86 4.7 5.39 5.03 5.04M2.62 4.62C1.88 5.32 1.4 6.08 1 6.5C1 6.5 2.8 10 6.5 10C7.4 10 8.19 9.77 8.87 9.39"
                  stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"
                />
              </svg>
            )}
          </button>
          <button
            title={node.locked ? "Unlock" : "Lock"}
            onClick={handleToggleLock}
            className="w-4 h-4 flex items-center justify-center hover:text-text-primary rounded"
          >
            {node.locked ? "🔒" : "🔓"}
          </button>
        </div>

        {/* Locked indicator */}
        {node.locked && (
          <span className="text-[10px] opacity-40 ml-1">🔒</span>
        )}
      </div>

      {/* Children */}
      {expanded && hasChildren && (
        <div>
          {node.children.map((child) => (
            <LayerNode key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
