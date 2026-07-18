import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useDocumentStore, beginUndoBatch, endUndoBatch } from "../store/documentStore";
import { useSettingsStore, activeKey, activeModel } from "../store/settingsStore";
import { findNode } from "./nodeUtils";
import { serializeFragment } from "./svgSerializer";
import { parseSVG } from "./svgParser";
import { extractSvg, extractPartialSvg } from "./svgExtract";
import type { VectoGradient, VectoNode } from "../types/svg";

export interface AiEditResult {
  ok: boolean;
  error?: string;
}

/**
 * Stream a selection-scoped (or whole-document) AI edit and apply the result
 * 1:1 onto the original nodes in place. Returns ok/error; selection ids stay
 * valid because nodes are edited in place. The whole edit is one undo step.
 */
export async function runAiEdit(nodeIds: string[], instruction: string): Promise<AiEditResult> {
  const settings = useSettingsStore.getState();
  const apiKey = activeKey(settings);
  if (!apiKey.trim()) { settings.openSettings(); return { ok: false }; }

  const doc = useDocumentStore.getState().document;
  if (!doc || nodeIds.length === 0) return { ok: false };
  const nodes = nodeIds.map((id) => findNode(doc.nodes, id)).filter(Boolean) as VectoNode[];
  if (nodes.length === 0) return { ok: false };

  // Marker ids let us map the model's output back to the originals 1:1.
  const tempMap = new Map<string, string>();
  const tagged = nodes.map((n, i) => {
    const marker = `vecto-edit-${i}`;
    tempMap.set(marker, n.id);
    return { ...n, svgId: marker };
  });
  // Include the gradients/filters these nodes reference so the model can see/edit them.
  const fragment = serializeFragment(tagged, doc.viewBox, {
    gradients: doc.gradients, filters: doc.filters,
  });

  const store = useDocumentStore.getState();
  const apply = (parsedNodes: VectoNode[], parsedGradients?: VectoGradient[]) => {
    const byId = new Map<string, VectoNode>();
    for (const p of parsedNodes) {
      if (p.svgId && tempMap.has(p.svgId)) byId.set(tempMap.get(p.svgId)!, p);
    }
    if (byId.size > 0) {
      for (const [origId, node] of byId) store.replaceNodeInPlace(origId, node);
    } else {
      const m = Math.min(parsedNodes.length, nodeIds.length);
      for (let i = 0; i < m; i++) store.replaceNodeInPlace(nodeIds[i], parsedNodes[i]);
    }
    // Merge any gradients the model returned (edited existing / newly added).
    if (parsedGradients && parsedGradients.length) store.upsertGradients(parsedGradients);
  };

  beginUndoBatch();
  const acc = { text: "" };
  let lastRender = 0;
  const unlisten = await listen<string>("svg:edit-chunk", (e) => {
    acc.text += e.payload;
    const now = Date.now();
    if (now - lastRender < 120) return;
    lastRender = now;
    const partial = extractPartialSvg(acc.text);
    if (!partial) return;
    try {
      const parsed = parseSVG(partial);
      if (parsed.nodes.length > 0) apply(parsed.nodes, parsed.gradients);
    } catch { /* mid-stream fragment may be malformed */ }
  });

  let result: AiEditResult = { ok: false };
  try {
    await invoke("edit_svg_stream", {
      instruction, svg: fragment, apiKey, provider: settings.provider, model: activeModel(settings),
    });
    const finalSvg = extractSvg(acc.text);
    if (finalSvg) {
      const parsed = parseSVG(finalSvg);
      if (parsed.nodes.length > 0) apply(parsed.nodes, parsed.gradients);
      result = { ok: true };
    } else {
      result = { ok: false, error: "The model didn't return valid SVG. Try rephrasing." };
    }
  } catch (err) {
    result = { ok: false, error: String(err) };
  } finally {
    unlisten();
    endUndoBatch();
  }
  return result;
}
