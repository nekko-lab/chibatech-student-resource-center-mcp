import { normalizeJa } from "./normalize";

const REIWA_BASE = 2018; // 令和 n 年 = 2018 + n
const HEISEI_BASE = 1988; // 平成 n 年 = 1988 + n

/** 相対表現と、今年度からのずれ。部分一致なので長い語を先に置く。 */
const RELATIVE_YEARS: readonly (readonly [string, number])[] = [
  ["一昨年度", -2],
  ["一昨年", -2],
  ["おととし", -2],
  ["今年度", 0],
  ["本年度", 0],
  ["今年", 0],
  ["昨年度", -1],
  ["前年度", -1],
  ["昨年", -1],
  ["去年", -1],
  ["来年度", 1],
  ["翌年度", 1],
  ["来年", 1],
].map(([w, d]) => [normalizeJa(w as string), d as number] as const);

const ERA_REIWA = /(?:令和|(?<![a-z])r)(元|\d{1,2})(?!\d)/;
const ERA_HEISEI = /(?:平成|(?<![a-z])h)(元|\d{1,2})(?!\d)/;
const FOUR_DIGIT = /(?<!\d)((?:19|20)\d{2})(?!\d)/;
const TWO_DIGIT_WITH_YEAR = /(?<![\d.])(\d{2})(?=年)/;
const TWO_DIGIT_ONLY = /^(\d{2})$/;

function eraNumber(s: string): number {
  return s === "元" ? 1 : Number(s);
}

/**
 * 正規化済みの文字列から、今日の日付に依らない年（西暦 4 桁・元号・「24年」）を取り出す。
 * 文中のどこにあってもよい。見つからなければ undefined。
 */
export function extractAbsoluteYear(normalized: string): number | undefined {
  const reiwa = ERA_REIWA.exec(normalized);
  if (reiwa?.[1]) return REIWA_BASE + eraNumber(reiwa[1]);
  const heisei = ERA_HEISEI.exec(normalized);
  if (heisei?.[1]) return HEISEI_BASE + eraNumber(heisei[1]);
  const four = FOUR_DIGIT.exec(normalized);
  if (four?.[1]) return Number(four[1]);
  const two = TWO_DIGIT_WITH_YEAR.exec(normalized);
  if (two?.[1]) return 2000 + Number(two[1]);
  return undefined;
}

/** 4 月始まりの年度。1〜3 月は前年度。 */
export function fiscalYearOf(today: Date): number {
  const y = today.getFullYear();
  return today.getMonth() + 1 >= 4 ? y : y - 1;
}

export function resolveYear(input: string, today: Date): number | undefined {
  const n = normalizeJa(input);
  if (n === "") return undefined;

  const absolute = extractAbsoluteYear(n);
  if (absolute !== undefined) return absolute;

  const bare = TWO_DIGIT_ONLY.exec(n);
  if (bare?.[1]) return 2000 + Number(bare[1]);

  for (const [word, delta] of RELATIVE_YEARS) {
    if (n.includes(word)) return fiscalYearOf(today) + delta;
  }
  return undefined;
}
