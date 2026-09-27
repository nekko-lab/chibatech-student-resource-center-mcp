import { DEPARTMENT_ALIASES } from "./data/departmentAliases";
import { normalizeJa } from "./normalize";
import { diceSimilarity } from "./similarity";
import type { Candidate, DeptOption } from "./types";
import { extractAbsoluteYear } from "./year";

/** 上位 2 件の score の差がこれ以下なら聞き返し（ambiguous）にする */
const AMBIGUITY_MARGIN = 0.03;
/** これ未満の score は候補にしない */
const MIN_CANDIDATE_SCORE = 0.2;

const SCORE = {
  code: 1,
  nameExact: 0.97,
  aliasExact: 0.95,
  queryContainsName: 0.9,
  queryContainsAlias: 0.85,
  /** 名称の部分一致: base + span × (問い合わせ長 / 名称長) */
  partialBase: 0.55,
  partialSpan: 0.35,
  /** 2-gram の似かたによる弱い一致: weight × Dice（Dice が threshold 以上のときだけ） */
  fuzzyWeight: 0.7,
  fuzzyThreshold: 0.3,
  /** 括弧内の課程注記（修士課程など）が問い合わせに現れたときの加点 */
  noteBonus: 0.05,
  /** 問い合わせの年が年度注記の範囲に入るとき／外れるとき */
  yearInRange: 0.05,
  yearOutOfRange: -0.2,
} as const;

const CODE_PREFIX = /^\s*([0-9A-Za-z０-９Ａ-Ｚａ-ｚ]{1,4})\s*[：:]\s*(.+?)\s*$/;

export function parseDeptOption(raw: string): DeptOption {
  const m = CODE_PREFIX.exec(raw);
  if (m?.[1] && m[2]) {
    return { code: m[1].normalize("NFKC").toUpperCase(), name: m[2] };
  }
  return { code: "", name: raw.trim() };
}

interface YearRange {
  from?: number;
  to?: number;
}

interface PreparedOption {
  option: DeptOption;
  code: string;
  /** 括弧の注記を除いた名称（正規化済み） */
  base: string;
  /** 名称全体（正規化済み） */
  full: string;
  /** 年度以外の注記（修士課程など、正規化済み） */
  notes: string[];
  years?: YearRange;
}

const PAREN = /\(([^()]*)\)/g;
const YEAR_IN_NOTE = /(?:19|20)\d{2}/g;

function parseYearNote(note: string): YearRange | undefined {
  const years = [...note.matchAll(YEAR_IN_NOTE)];
  if (years.length === 0) return undefined;
  const wave = note.indexOf("~");
  if (wave === -1) {
    const y = Number(years[0]![0]);
    return { from: y, to: y };
  }
  const range: YearRange = {};
  for (const m of years) {
    const y = Number(m[0]);
    if ((m.index ?? 0) < wave) range.from = y;
    else range.to = y;
  }
  return range;
}

function prepare(option: DeptOption): PreparedOption {
  const parsed = parseDeptOption(option.name);
  const code = normalizeJa(option.code || parsed.code);
  const name = parsed.code ? parsed.name : option.name;
  const full = normalizeJa(name);
  const notes: string[] = [];
  let years: YearRange | undefined;
  for (const m of full.matchAll(PAREN)) {
    const note = m[1] ?? "";
    const y = parseYearNote(note);
    if (y) years = y;
    else if (note) notes.push(note);
  }
  const base = full.replace(PAREN, "");
  return years ? { option, code, base, full, notes, years } : { option, code, base, full, notes };
}

const NORMALIZED_ALIASES: readonly (readonly [string, ReadonlySet<string>])[] = Object.entries(
  DEPARTMENT_ALIASES,
).map(([alias, targets]) => [normalizeJa(alias), new Set(targets.map(normalizeJa))] as const);

/** 問い合わせに含まれる略称のうち、より長い略称の一部になっていないもの */
function aliasesInQuery(q: string): string[] {
  const found = NORMALIZED_ALIASES.map(([a]) => a).filter((a) => a.length > 0 && q.includes(a));
  return found.filter((a) => !found.some((b) => b !== a && b.includes(a)));
}

function nameScore(
  q: string,
  p: PreparedOption,
  queryIsInSomeName: boolean,
  containedAliases: readonly string[],
): { score: number; reason: string } {
  let best = { score: 0, reason: "" };
  const consider = (score: number, reason: string) => {
    if (score > best.score) best = { score, reason };
  };

  if (q === p.base || q === p.full) consider(SCORE.nameExact, "名称が一致");
  if (p.base.length >= 2 && q.includes(p.base)) consider(SCORE.queryContainsName, "問い合わせが名称を含む");

  for (const [alias, targets] of NORMALIZED_ALIASES) {
    if (!targets.has(p.base)) continue;
    if (q === alias) consider(SCORE.aliasExact, `略称「${alias}」`);
    else if (!queryIsInSomeName && containedAliases.includes(alias)) {
      consider(SCORE.queryContainsAlias, `問い合わせが略称「${alias}」を含む`);
    }
  }

  if (p.base.includes(q)) {
    consider(SCORE.partialBase + SCORE.partialSpan * (q.length / p.base.length), "名称の部分一致");
  }

  const dice = diceSimilarity(q, p.base);
  if (dice >= SCORE.fuzzyThreshold) consider(SCORE.fuzzyWeight * dice, "名称の一部が似ている");

  return best;
}

/** 括弧内の注記による加減点（課程注記の一致、入学年度の範囲内／外）。 */
function adjust(q: string, qYear: number | undefined, p: PreparedOption): { delta: number; reasons: string[] } {
  let delta = 0;
  const why: string[] = [];
  for (const note of p.notes) {
    if (q.includes(note) || (note.length >= 2 && q.includes(note.slice(0, 2)))) {
      delta += SCORE.noteBonus;
      why.push(`注記「${note}」`);
      break;
    }
  }
  if (qYear !== undefined && p.years) {
    const { from = -Infinity, to = Infinity } = p.years;
    if (qYear >= from && qYear <= to) {
      delta += SCORE.yearInRange;
      why.push(`${qYear}年度は範囲内`);
    } else {
      delta += SCORE.yearOutOfRange;
      why.push(`${qYear}年度は範囲外`);
    }
  }
  return { delta, reasons: why };
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function resolveDepartment(
  query: string,
  options: DeptOption[],
): { best?: DeptOption; candidates: Candidate<DeptOption>[]; ambiguous: boolean } {
  const q = normalizeJa(query);
  if (q === "" || options.length === 0) return { candidates: [], ambiguous: false };

  const prepared = options.map(prepare);
  const qYear = extractAbsoluteYear(q);
  const queryIsInSomeName = prepared.some((p) => p.base.includes(q));
  const containedAliases = aliasesInQuery(q);

  const candidates: Candidate<DeptOption>[] = [];
  for (const p of prepared) {
    if (p.code !== "" && q === p.code) {
      candidates.push({ item: p.option, score: SCORE.code, reason: "コードが一致" });
      continue;
    }
    const base = nameScore(q, p, queryIsInSomeName, containedAliases);
    if (base.score <= 0) continue;
    const { delta, reasons } = adjust(q, qYear, p);
    const score = clamp01(base.score + delta);
    if (score < MIN_CANDIDATE_SCORE) continue;
    candidates.push({ item: p.option, score, reason: [base.reason, ...reasons].join("、") });
  }

  candidates.sort((a, b) => b.score - a.score);

  const [first, second] = candidates;
  const ambiguous = first !== undefined && second !== undefined && first.score - second.score <= AMBIGUITY_MARGIN;
  if (first && !ambiguous) return { best: first.item, candidates, ambiguous };
  return { candidates, ambiguous };
}
