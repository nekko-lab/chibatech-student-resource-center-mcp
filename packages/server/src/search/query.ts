/**
 * 検索語の解析と同義語の展開。
 *
 * 展開の規則は `@chibatech-src/match` の searchByKeyword に合わせる（辞書は SYNONYM_GROUPS と QUERY_SUFFIX_FILLERS を使う）。
 * searchByKeyword は 1 件ずつ本文を舐める作りで、展開した語の一覧を外に出さないため、ここで同じ規則を組み直している。
 */
import { QUERY_SUFFIX_FILLERS, SYNONYM_GROUPS, normalizeJa } from "@chibatech-src/match";

/** 1 回の検索で扱う語の数の上限 */
export const MAX_TERMS = 8;

export const NEEDLE_WEIGHT = {
  /** 利用者の語そのもの（末尾の言い回しを落とした形を含む） */
  literal: 1,
  /** 語に含まれていた辞書の語（「給付型奨学金」の「奨学金」） */
  containedMember: 0.8,
  /** 同義語 */
  synonym: 0.75,
  /** 含まれていた辞書の語の同義語 */
  containedSynonym: 0.65,
} as const;

export interface Needle {
  /** 正規化済みの、本文に探す文字列 */
  text: string;
  weight: number;
  /** 利用者の語そのものでないとき true */
  synonym: boolean;
  /** literal: 語そのもの / part: 語に含まれる辞書の語 / synonym: 同義語 / part_synonym: 語に含まれる辞書の語の同義語 */
  kind: "literal" | "part" | "synonym" | "part_synonym";
  /** 表示用の形（辞書の語は辞書の表記、語そのものは正規化した形） */
  display: string;
}

export interface ParsedTerm {
  /** 利用者が書いたままの語 */
  raw: string;
  /** 正規化した語 */
  norm: string;
  /** 本文に探す文字列（重い順） */
  needles: Needle[];
}

/** 同義語のグループ（正規化した形 → 辞書の表記） */
const GROUPS: readonly ReadonlyMap<string, string>[] = SYNONYM_GROUPS.map((g) => {
  const m = new Map<string, string>();
  for (const w of g) {
    const n = normalizeJa(w);
    if (n && !m.has(n)) m.set(n, w);
  }
  return m;
});
const FILLERS: readonly string[] = QUERY_SUFFIX_FILLERS.map(normalizeJa).sort((a, b) => b.length - a.length);

function variantsOf(term: string): string[] {
  const out = [term];
  for (const f of FILLERS) {
    if (term.length > f.length && term.endsWith(f)) {
      out.push(term.slice(0, -f.length));
      break;
    }
  }
  return out;
}

export function needlesOf(term: string): Needle[] {
  const byText = new Map<string, Needle>();
  const add = (text: string, kind: Needle["kind"], display: string) => {
    const weight =
      kind === "literal"
        ? NEEDLE_WEIGHT.literal
        : kind === "part"
          ? NEEDLE_WEIGHT.containedMember
          : kind === "synonym"
            ? NEEDLE_WEIGHT.synonym
            : NEEDLE_WEIGHT.containedSynonym;
    const prev = byText.get(text);
    if (!prev || prev.weight < weight) byText.set(text, { text, weight, synonym: kind !== "literal", kind, display });
  };
  const variants = variantsOf(term);
  for (const v of variants) add(v, "literal", v);
  for (const group of GROUPS) {
    const members = [...group.keys()];
    if (members.some((m) => variants.includes(m))) {
      for (const [m, orig] of group) add(m, "synonym", orig);
      continue;
    }
    const contained = members.filter((m) => m.length >= 2 && variants.some((v) => v.includes(m)));
    if (contained.length === 0) continue;
    for (const [m, orig] of group) add(m, contained.includes(m) ? "part" : "part_synonym", orig);
  }
  return [...byText.values()].sort((a, b) => b.weight - a.weight || b.text.length - a.text.length);
}

/** 空白（半角・全角）で区切った語を正規化し、同義語を展開する。同じ語は 1 つにまとめ、MAX_TERMS 個までにする */
export function parseQuery(query: string): ParsedTerm[] {
  const out: ParsedTerm[] = [];
  const seen = new Set<string>();
  for (const raw of query.split(/[\s　]+/)) {
    const norm = normalizeJa(raw);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push({ raw, norm, needles: needlesOf(norm) });
    if (out.length >= MAX_TERMS) break;
  }
  return out;
}
