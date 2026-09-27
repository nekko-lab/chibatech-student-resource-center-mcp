/**
 * 全文検索の正規化。`@chibatech-src/match` の normalizeJa と同じ結果を、文字ごとに作る。
 *
 * - 本文は長いので、文字（と後続の結合文字）ごとに normalizeJa を呼び、結果を覚えておく
 *   （異なる文字は数千種類しかないので、ほとんどが表引きで済む）
 * - 抜粋を作るときは、正規化後の各文字が元の本文のどこから来たか（start / end）も返す
 */
import { normalizeJa } from "@chibatech-src/match";

const memo = new Map<string, string>();
const MEMO_LIMIT = 50_000;

function normChunk(chunk: string): string {
  let v = memo.get(chunk);
  if (v === undefined) {
    v = normalizeJa(chunk);
    if (memo.size < MEMO_LIMIT) memo.set(chunk, v);
  }
  return v;
}

// 直前の文字と一緒に正規化すべき文字（結合文字と、半角カナの濁点・半濁点）
const COMBINING = /[\p{M}ﾞﾟ]/u;

/** 本文を「文字 + 後続の結合文字」のかたまりに分けて f に渡す */
function eachChunk(s: string, f: (chunk: string, start: number, end: number) => void): void {
  let i = 0;
  while (i < s.length) {
    const start = i;
    i += (s.codePointAt(i) ?? 0) > 0xffff ? 2 : 1;
    while (i < s.length && COMBINING.test(s[i]!)) i++;
    f(s.slice(start, i), start, i);
  }
}

/** normalizeJa と同じ結果（長い本文向け） */
export function normalizeText(s: string): string {
  const out: string[] = [];
  eachChunk(s, (c) => {
    const n = normChunk(c);
    if (n) out.push(n);
  });
  return out.join("");
}

export interface NormalizedText {
  norm: string;
  /** norm の i 文字目（UTF-16 単位）が元の本文の [start[i], end[i]) から来た */
  start: Uint32Array;
  end: Uint32Array;
}

export function normalizeWithMap(s: string): NormalizedText {
  const parts: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  eachChunk(s, (c, a, b) => {
    const n = normChunk(c);
    if (!n) return;
    parts.push(n);
    for (let k = 0; k < n.length; k++) {
      starts.push(a);
      ends.push(b);
    }
  });
  return { norm: parts.join(""), start: Uint32Array.from(starts), end: Uint32Array.from(ends) };
}

/** 重複を除いた 2-gram（出現順） */
export function bigramsOf(s: string): string[] {
  const seen = new Set<string>();
  for (let i = 0; i + 1 < s.length; i++) seen.add(s.slice(i, i + 2));
  return [...seen];
}
