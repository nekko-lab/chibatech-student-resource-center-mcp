/** PDF へのリンク（`life.pdf#page=13` など）を URL とページ番号に分ける。 */
export interface PdfLink {
  /** fragment を除いた絶対 URL。クエリ（`?20260611_01` など）は残す。 */
  url: string;
  /** `#page=N` があれば N（1 始まり）。 */
  page?: number;
}

export function parsePdfLink(href: string, base: string): PdfLink {
  const u = new URL(href.trim(), base);
  const page = pageFromFragment(u.hash);
  u.hash = "";
  const url = u.toString();
  return page === undefined ? { url } : { url, page };
}

/** `#page=13`・`#zoom=100&page=13` のような open parameters から page を読む。 */
function pageFromFragment(hash: string): number | undefined {
  if (hash.length <= 1) return undefined;
  for (const part of hash.slice(1).split("&")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).toLowerCase() !== "page") continue;
    const value = part.slice(eq + 1);
    if (!/^\d+$/.test(value)) return undefined;
    const n = Number(value);
    return Number.isSafeInteger(n) && n >= 1 ? n : undefined;
  }
  return undefined;
}
