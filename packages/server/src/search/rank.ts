/**
 * 検索と採点。2-gram で候補を絞り、正規化後の本文の部分一致で確かめる。
 *
 * score（高いほど上）:
 * - 一致した語ごとに、当たった文字列の重み（語そのもの 1、同義語 0.65〜0.8）
 * - 出現回数の加点（語ごとに 5 回で頭打ち、最大 0.2）
 * - 語どうしの近さ（2 語以上のとき、全語を含む最短区間の隙間が小さいほど最大 0.5）
 * すべての語を含むページが無いときだけ、一部の語を含むページを返す（一致した語の多い順）。
 */
import type { BigramIndex, PageRef } from "./bigram.ts";
import type { Needle, ParsedTerm } from "./query.ts";

/** 1 語・1 ページで覚えておく出現位置の上限 */
const MAX_POSITIONS = 64;

const SCORE = {
  tfMax: 0.2,
  tfCap: 5,
  proximityMax: 0.5,
  /** 隙間がこの文字数のとき、近さの加点が半分になる */
  proximityHalf: 40,
} as const;

export interface Span {
  /** 正規化後の本文での位置 */
  start: number;
  end: number;
}

export interface TermHit {
  /** 利用者が書いたままの語 */
  term: string;
  /** 本文に当たった文字列（正規化済み） */
  needle: string;
  weight: number;
  synonym: boolean;
  kind: Needle["kind"];
  /** 表示用の形 */
  display: string;
  count: number;
  positions: Span[];
}

export interface PageHit {
  ref: PageRef;
  score: number;
  /** 一致した語（検索語の順） */
  terms: TermHit[];
  /** 一致した全語を 1 回ずつ含む最短区間（2 語以上のとき） */
  window?: Span;
}

export interface SearchResult {
  hits: PageHit[];
  /** all: すべての語を含むページがあった / some: 一部の語だけ / none: 当たり無し */
  mode: "all" | "some" | "none";
}

function positionsOf(norm: string, needle: string): { count: number; positions: Span[] } {
  const positions: Span[] = [];
  let count = 0;
  let i = norm.indexOf(needle);
  while (i >= 0) {
    count++;
    if (positions.length < MAX_POSITIONS) positions.push({ start: i, end: i + needle.length });
    i = norm.indexOf(needle, i + needle.length);
  }
  return { count, positions };
}

/** 語ごとの最良の一致（重い文字列から試し、最初に部分一致したもの） */
function matchTerm(index: BigramIndex, term: ParsedTerm, filter?: (url: string) => boolean): Map<number, TermHit> {
  const out = new Map<number, TermHit>();
  for (const n of term.needles) {
    for (const p of index.candidates(n.text)) {
      if (out.has(p.id) || (filter && !filter(p.url))) continue;
      const { count, positions } = positionsOf(p.norm, n.text);
      if (count === 0) continue; // 2-gram は揃っていても部分一致しない
      out.set(p.id, { term: term.raw, needle: n.text, weight: n.weight, synonym: n.synonym, kind: n.kind, display: n.display, count, positions });
    }
  }
  return out;
}

/** 全語を 1 回ずつ含む最短区間 */
export function minimalWindow(terms: readonly TermHit[]): Span | undefined {
  if (terms.length < 2) return undefined;
  const occ = terms
    .flatMap((t, k) => t.positions.map((s) => ({ ...s, k })))
    .sort((a, b) => a.start - b.start);
  const need = terms.length;
  const counts = new Array<number>(need).fill(0);
  let have = 0;
  let best: Span | undefined;
  let l = 0;
  for (let r = 0; r < occ.length; r++) {
    const o = occ[r]!;
    if (counts[o.k]!++ === 0) have++;
    while (have === need) {
      const first = occ[l]!;
      let end = 0;
      for (let i = l; i <= r; i++) end = Math.max(end, occ[i]!.end);
      if (!best || end - first.start < best.end - best.start) best = { start: first.start, end };
      if (--counts[first.k]! === 0) have--;
      l++;
    }
  }
  return best;
}

function scoreOf(terms: readonly TermHit[], window: Span | undefined): number {
  let s = 0;
  for (const t of terms) s += t.weight + (SCORE.tfMax * Math.min(t.count, SCORE.tfCap)) / SCORE.tfCap;
  if (window) {
    const used = terms.reduce((a, t) => a + t.needle.length, 0);
    const gap = Math.max(0, window.end - window.start - used);
    s += (SCORE.proximityMax * SCORE.proximityHalf) / (SCORE.proximityHalf + gap);
  }
  return s;
}

export function searchPages(
  index: BigramIndex,
  terms: readonly ParsedTerm[],
  opts: { limit: number; filter?: (url: string) => boolean },
): SearchResult {
  if (terms.length === 0 || opts.limit <= 0) return { hits: [], mode: "none" };
  const perTerm = terms.map((t) => matchTerm(index, t, opts.filter));
  const ids = new Set<number>();
  for (const m of perTerm) for (const id of m.keys()) ids.add(id);

  const hits: PageHit[] = [];
  for (const id of ids) {
    const matched = perTerm.map((m) => m.get(id)).filter((t): t is TermHit => t !== undefined);
    const window = minimalWindow(matched);
    const hit: PageHit = { ref: index.pages[id]!, score: scoreOf(matched, window), terms: matched };
    if (window) hit.window = window;
    hits.push(hit);
  }
  const all = hits.filter((h) => h.terms.length === terms.length);
  const pool = all.length > 0 ? all : hits;
  const mode: SearchResult["mode"] = pool.length === 0 ? "none" : all.length > 0 ? "all" : "some";
  pool.sort((a, b) => b.terms.length - a.terms.length || b.score - a.score || a.ref.id - b.ref.id);
  return { hits: pool.slice(0, opts.limit), mode };
}
