import { QUERY_SUFFIX_FILLERS, SYNONYM_GROUPS } from "./data/synonyms";
import { normalizeJa } from "./normalize";
import { bigramContainment } from "./similarity";
import type { Candidate } from "./types";

const DEFAULT_LIMIT = 20;
const DEFAULT_MIN_SCORE = 0;

const WEIGHT = {
  /** 利用者の語そのもの（言い回しを落とした形を含む） */
  literal: 1,
  /** 利用者の語に含まれていた辞書語（例: 「給付型奨学金」の「奨学金」） */
  containedMember: 0.8,
  /** 同義語 */
  synonym: 0.75,
  /** 含まれていた辞書語の同義語 */
  containedSynonym: 0.65,
  /** 2-gram の一部一致: weight × 割合（割合が threshold 以上のときだけ、3 文字以上の語） */
  fuzzy: 0.5,
  fuzzyThreshold: 0.6,
  fuzzyMinLength: 3,
  /** 最終 score = 語の平均 × (coverageBase + coverageSpan × 被覆率) */
  coverageBase: 0.9,
  coverageSpan: 0.1,
} as const;

const GROUPS: readonly (readonly string[])[] = SYNONYM_GROUPS.map((g) => [...new Set(g.map(normalizeJa))]);
const FILLERS: readonly string[] = QUERY_SUFFIX_FILLERS.map(normalizeJa).sort((a, b) => b.length - a.length);

interface Needle {
  text: string;
  weight: number;
  label: string;
}

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

/** 1 つの検索語から、本文に探す文字列（重み付き）を作る。同じ文字列は重いほうを残す。 */
function needlesOf(term: string): Needle[] {
  const byText = new Map<string, Needle>();
  const add = (text: string, weight: number, label: string) => {
    const prev = byText.get(text);
    if (!prev || prev.weight < weight) byText.set(text, { text, weight, label });
  };

  const variants = variantsOf(term);
  for (const v of variants) add(v, WEIGHT.literal, `「${v}」を含む`);

  for (const group of GROUPS) {
    const equal = group.some((m) => variants.includes(m));
    const contained = !equal && group.filter((m) => m.length >= 2 && variants.some((v) => v.includes(m)));
    if (equal) {
      for (const m of group) add(m, WEIGHT.synonym, `同義語「${m}」`);
    } else if (contained && contained.length > 0) {
      for (const m of group) {
        if (contained.includes(m)) add(m, WEIGHT.containedMember, `語の一部「${m}」`);
        else add(m, WEIGHT.containedSynonym, `語の一部の同義語「${m}」`);
      }
    }
  }
  // 利用者の語そのものが最優先
  for (const v of variants) add(v, WEIGHT.literal, `「${v}」を含む`);
  return [...byText.values()];
}

interface TermMatch {
  score: number;
  length: number;
  label: string;
}

function matchTerm(term: string, needles: readonly Needle[], text: string): TermMatch | undefined {
  let best: TermMatch | undefined;
  for (const n of needles) {
    if (n.text.length === 0 || !text.includes(n.text)) continue;
    if (!best || n.weight > best.score || (n.weight === best.score && n.text.length > best.length)) {
      best = { score: n.weight, length: n.text.length, label: n.label };
    }
  }
  if (best) return best;

  if (term.length >= WEIGHT.fuzzyMinLength) {
    const ratio = bigramContainment(term, text);
    if (ratio >= WEIGHT.fuzzyThreshold) {
      return { score: WEIGHT.fuzzy * ratio, length: Math.round(term.length * ratio), label: `「${term}」に近い` };
    }
  }
  return undefined;
}

export function searchByKeyword<T>(
  query: string,
  items: T[],
  getText: (t: T) => string,
  opts?: { limit?: number; minScore?: number },
): Candidate<T>[] {
  const limit = opts?.limit ?? DEFAULT_LIMIT;
  const minScore = opts?.minScore ?? DEFAULT_MIN_SCORE;

  const terms = query
    .normalize("NFKC")
    .split(/\s+/)
    .map(normalizeJa)
    .filter((t) => t.length > 0);
  if (terms.length === 0 || limit <= 0) return [];

  const plans = terms.map((term) => ({ term, needles: needlesOf(term) }));

  const out: Candidate<T>[] = [];
  for (const item of items) {
    const text = normalizeJa(getText(item));
    if (text.length === 0) continue;

    let sum = 0;
    let covered = 0;
    const labels: string[] = [];
    let allMatched = true;
    for (const { term, needles } of plans) {
      const m = matchTerm(term, needles, text);
      if (!m) {
        allMatched = false; // 複数語は AND
        break;
      }
      sum += m.score;
      covered += m.length;
      labels.push(m.label);
    }
    if (!allMatched) continue;

    const coverage = Math.min(1, covered / text.length);
    const score = (sum / plans.length) * (WEIGHT.coverageBase + WEIGHT.coverageSpan * coverage);
    if (score <= 0 || score < minScore) continue;
    out.push({ item, score: Math.min(1, score), reason: labels.join("、") });
  }

  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}
