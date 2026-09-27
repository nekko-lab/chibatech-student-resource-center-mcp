/**
 * 区分・入学年度・学科の解決（引数 → プロフィールの順）。曖昧・不足なら聞き返しの Outcome を返す。
 */
import { normalizeJa, resolveDepartment, resolveStudentType, resolveYear, searchByKeyword } from "@chibatech-src/match";
import { PortalError, type DepartmentOption, type QuickLink, type StudentType } from "@chibatech-src/portal";
import { clarify, type Outcome, type Source } from "../respond.ts";
import type { DeptPage, MacroEnv } from "./ports.ts";

export const STUDENT_TYPE_CHOICES = [
  { value: "undergrad", label: "学部生" },
  { value: "graduate", label: "大学院生" },
] as const;

export type Resolved<T> = { ok: true; value: T } | { ok: false; outcome: Outcome };

export function resolveType(env: MacroEnv, input: string | undefined): Resolved<StudentType> {
  const raw = input?.trim();
  if (raw) {
    const t = resolveStudentType(raw);
    if (t) return { ok: true, value: t };
    return {
      ok: false,
      outcome: clarify(`区分「${raw}」を読み取れませんでした。学部生か大学院生かを教えてください`, [...STUDENT_TYPE_CHOICES], []),
    };
  }
  if (env.profile.studentType) return { ok: true, value: env.profile.studentType };
  return { ok: false, outcome: clarify("学部生か大学院生かを教えてください", [...STUDENT_TYPE_CHOICES], []) };
}

export async function resolveAdmissionYear(
  env: MacroEnv,
  type: StudentType,
  input: number | string | undefined,
): Promise<Resolved<number>> {
  let year: number | undefined;
  let raw: string | undefined;
  if (typeof input === "number") year = input;
  else if (typeof input === "string" && input.trim()) {
    raw = input.trim();
    year = resolveYear(raw, env.now());
  } else year = env.profile.admissionYear;
  if (year !== undefined && Number.isInteger(year)) return { ok: true, value: year };
  const years = await env.portal.years(type);
  const q = raw ? `入学年度「${raw}」を読み取れませんでした。入学年度を教えてください` : "入学年度を教えてください";
  return { ok: false, outcome: clarify(q, years, []) };
}

/** VALIDATION（details.available）の中身を取り出す */
function availableOf(e: unknown): unknown[] | undefined {
  if (e instanceof PortalError && e.code === "VALIDATION") {
    const a = (e.details as { available?: unknown } | undefined)?.available;
    if (Array.isArray(a)) return a;
  }
  return undefined;
}

export async function departmentOptions(env: MacroEnv, type: StudentType, year: number): Promise<Resolved<DepartmentOption[]>> {
  try {
    return { ok: true, value: await env.portal.departments(type, year) };
  } catch (e) {
    const available = availableOf(e);
    if (!available) throw e;
    return { ok: false, outcome: clarify(`入学年度 ${year} は選べません。入学年度を教えてください`, available, []) };
  }
}

export function pickDepartment(options: DepartmentOption[], query: string | undefined): Resolved<DepartmentOption> {
  const q = query?.trim();
  if (!q) return { ok: false, outcome: clarify("学科・専攻を教えてください", options, []) };
  const r = resolveDepartment(q, options);
  if (r.best) return { ok: true, value: r.best };
  if (r.ambiguous) {
    return {
      ok: false,
      outcome: clarify(
        `「${q}」に当たる学科・専攻が複数あります。どれですか`,
        r.candidates.slice(0, 8).map((c) => ({ code: c.item.code, name: c.item.name })),
        [],
      ),
    };
  }
  return { ok: false, outcome: clarify(`「${q}」に当たる学科・専攻が見つかりません。次から選んでください`, options, []) };
}

export interface LocatedDepartment {
  studentType: StudentType;
  admissionYear: number;
  department: DepartmentOption;
  page: DeptPage;
}

export interface DepartmentArgs {
  studentType?: string | undefined;
  year?: number | string | undefined;
  department?: string | undefined;
}

/** 区分・年度を解決 → 選択肢で学科を解決 → 学科ページ */
export async function locateDepartment(env: MacroEnv, args: DepartmentArgs): Promise<Resolved<LocatedDepartment>> {
  const type = resolveType(env, args.studentType);
  if (!type.ok) return type;
  const year = await resolveAdmissionYear(env, type.value, args.year);
  if (!year.ok) return year;
  const options = await departmentOptions(env, type.value, year.value);
  if (!options.ok) return options;
  const dept = pickDepartment(options.value, args.department ?? env.profile.department);
  if (!dept.ok) return dept;
  const page = await env.portal.departmentPage(type.value, year.value, dept.value.code);
  return { ok: true, value: { studentType: type.value, admissionYear: year.value, department: dept.value, page: page } };
}

export function pageSource(p: { heading?: string; title?: string; url: string; lastModified: string | null }): Source {
  return { title: p.heading ?? p.title ?? null, url: p.url, lastModified: p.lastModified };
}

/** 別名を順に試してクイックリンクを 1 件選ぶ（別名が題名に含まれるもの。複数なら PDF を優先） */
export function findQuickLink(links: QuickLink[], aliases: readonly string[], what: string): QuickLink {
  for (const alias of aliases) {
    const key = normalizeJa(alias);
    const hits = links.filter((l) => normalizeJa(l.title).includes(key));
    if (hits.length > 0) return hits.find((l) => l.kind === "pdf") ?? hits[0]!;
  }
  throw new PortalError("NOT_FOUND", `クイックリンクに「${what}」が見つかりません`, {
    tried: [...aliases],
    available: links.map((l) => l.title),
  });
}

/** キーワードに当たるページ番号（当たらなければ undefined） */
export function pagesMatching(query: string, pages: { page: number; text: string }[]): number[] | undefined {
  const hits = searchByKeyword(query, pages, (p) => p.text, { limit: pages.length, minScore: 0.3 });
  if (hits.length === 0) return undefined;
  return hits.map((h) => h.item.page).sort((a, b) => a - b);
}
