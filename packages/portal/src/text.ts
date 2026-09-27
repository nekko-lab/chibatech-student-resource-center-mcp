/** ASCII の空白類だけを 1 つにまとめる（全角空白「　」は文言の一部として残す） */
export function normalizeSpace(s: string | null | undefined): string {
  return (s ?? "").replace(/[ \t\n\r\f ]+/g, " ").trim();
}

/** 名前照合用: 空白（全角を含む）を除き、NFKC で揃える */
export function matchKey(s: string): string {
  return s.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

/** 「2026年04月01日」→「2026-04-01」。形が違えばそのまま返す */
export function toIsoDate(s: string): string {
  const m = /(\d{4})\s*[年./-]\s*(\d{1,2})\s*[月./-]\s*(\d{1,2})/.exec(s);
  if (!m) return s;
  const [, y = "", mo = "", d = ""] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

/** URL のパス末尾の拡張子（小文字）。無ければ undefined */
export function extOf(url: string): string | undefined {
  try {
    const last = new URL(url).pathname.split("/").pop() ?? "";
    const m = /\.([a-z0-9]{1,5})$/i.exec(last);
    return m?.[1]?.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * 文書名に付いた注記（「（※…）」「　※…」）を切り出す。
 * 例: 「VPN 接続（※学生専用/…ログインしてください）」→ title「VPN 接続」, notes ["※学生専用/…"]
 */
export function splitNotes(raw: string): { title: string; notes: string[] } {
  const notes: string[] = [];
  let t = raw.replace(/[（(]\s*(※[^）)]*)[）)]/g, (_m, n: string) => {
    notes.push(n.trim());
    return "";
  });
  t = t.replace(/[\s　]*(※.*)$/, (_m, n: string) => {
    notes.push(n.trim());
    return "";
  });
  return { title: t.trim(), notes };
}
