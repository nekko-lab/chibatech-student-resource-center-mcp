/**
 * 抜粋の切り出し。本文そのものは返さず、一致箇所の前後だけを短く返す。
 *
 * - 1 つの抜粋は、一致箇所の前後を合わせて EXCERPT_MAX_CHARS 文字まで（切ったところの「…」も含む）
 * - 1 ページ EXCERPTS_PER_PAGE か所まで。2 語以上が近くにあれば、それらを 1 つの抜粋にまとめる
 * - 表記は元の本文のまま（正規化前）。改行と連続する空白は 1 つの空白にする
 */
import type { PageHit, Span } from "./rank.ts";
import { normalizeWithMap } from "./text.ts";

export const EXCERPT_MAX_CHARS = 160;
export const EXCERPTS_PER_PAGE = 2;

const ELLIPSIS = "…";

/** 元の本文の [s, e) を中心に、maxChars 文字までの抜粋を作る */
export function cutExcerpt(text: string, s: number, e: number, maxChars: number = EXCERPT_MAX_CHARS): { excerpt: string; from: number; to: number } {
  const budget = Math.max(1, maxChars - 2 * ELLIPSIS.length);
  let a: number;
  let b: number;
  if (e - s >= budget) {
    a = s;
    b = s + budget;
  } else {
    a = Math.max(0, s - Math.floor((budget - (e - s)) / 2));
    b = Math.min(text.length, a + budget);
    a = Math.max(0, b - budget);
  }
  // サロゲートペアを割らない
  if (a > 0 && isLow(text.charCodeAt(a))) a++;
  if (b < text.length && isLow(text.charCodeAt(b))) b--;
  let body = text.slice(a, b).replace(/\s+/g, " ").trim();
  if (a > 0) body = ELLIPSIS + body;
  if (b < text.length) body += ELLIPSIS;
  return { excerpt: body, from: a, to: b };
}

const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

export function makeExcerpts(
  hit: PageHit,
  opts: { maxChars?: number; maxExcerpts?: number } = {},
): string[] {
  const maxChars = opts.maxChars ?? EXCERPT_MAX_CHARS;
  const maxExcerpts = opts.maxExcerpts ?? EXCERPTS_PER_PAGE;
  const text = hit.ref.text;
  const map = normalizeWithMap(text);
  const orig = (sp: Span) => ({ s: map.start[sp.start] ?? 0, e: map.end[Math.max(sp.start, sp.end - 1)] ?? text.length });

  // 候補の区間: 最短区間（あれば）→ 重い語の出現位置の順
  const spans: Span[] = [];
  if (hit.window) spans.push(hit.window);
  const byWeight = [...hit.terms].sort((x, y) => y.weight - x.weight);
  const occ = byWeight.flatMap((t) => t.positions);
  spans.push(...occ);

  const out: string[] = [];
  const used: { from: number; to: number }[] = [];
  for (const sp of spans) {
    if (out.length >= maxExcerpts) break;
    const { s, e } = orig(sp);
    if (e - s > maxChars) continue; // 最短区間が長すぎるときは語ごとの位置に任せる
    if (used.some((u) => s < u.to && e > u.from)) continue;
    const r = cutExcerpt(text, s, e, maxChars);
    used.push(r);
    out.push(r.excerpt);
  }
  return out;
}
