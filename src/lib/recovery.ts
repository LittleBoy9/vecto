// Crash-recovery snapshot of the working document, stored in localStorage.

const KEY = "vecto-recovery";

export interface Recovery {
  svg: string;
  filePath: string | null;
  ts: number;
}

export function saveRecovery(svg: string, filePath: string | null) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ svg, filePath, ts: Date.now() }));
  } catch { /* quota / private mode — ignore */ }
}

export function loadRecovery(): Recovery | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Recovery) : null;
  } catch {
    return null;
  }
}

export function clearRecovery() {
  try {
    localStorage.removeItem(KEY);
  } catch { /* ignore */ }
}
