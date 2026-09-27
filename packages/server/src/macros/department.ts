/**
 * 学科ページを起点にするマクロ: find_department_page / lookup_requirements / lookup_handbook_topic
 */
import { normalizeJa, searchByKeyword } from "@chibatech-src/match";
import { pageRangeForItem, type PageRange } from "@chibatech-src/pdf";
import type { SectionItem } from "@chibatech-src/portal";
import type { TextLimits } from "../docs.ts";
import { clarify, ok, type Outcome, type Source } from "../respond.ts";
import type { DeptPage, MacroEnv } from "./ports.ts";
import { locateDepartment, pageSource, type DepartmentArgs, type LocatedDepartment } from "./resolve.ts";

interface FlatItem extends SectionItem {
  section: string;
  index: number;
}

function flatten(page: DeptPage): FlatItem[] {
  let i = 0;
  return page.sections.flatMap((s) => s.items.map((it) => ({ ...it, section: s.title, index: i++ })));
}

function located(l: LocatedDepartment): Record<string, unknown> {
  return {
    studentType: l.studentType,
    admissionYear: l.admissionYear,
    department: { code: l.department.code, name: l.department.name },
  };
}

export async function findDepartmentPage(env: MacroEnv, args: DepartmentArgs): Promise<Outcome> {
  const l = await locateDepartment(env, args);
  if (!l.ok) return l.outcome;
  const p = l.value.page;
  return ok({ ...located(l.value), heading: p.heading, url: p.url, sections: p.sections }, [pageSource(p)]);
}

/** 項目が占めるページの本文を読む（同じ PDF の後続項目から範囲を推定） */
async function readItem(
  env: MacroEnv,
  items: FlatItem[],
  item: FlatItem,
  limits: Partial<TextLimits>,
): Promise<{ range: PageRange; read: Awaited<ReturnType<MacroEnv["docs"]["readText"]>> }> {
  const links = items.map((i) => (i.page === undefined ? { url: i.pdfUrl ?? i.href } : { url: i.pdfUrl ?? i.href, page: i.page }));
  const range = pageRangeForItem(links, item.index);
  const read = await env.docs.readText(item.pdfUrl!, { from: range.from, ...(range.to !== undefined ? { to: range.to } : {}), limits });
  return { range, read };
}

function itemCandidates(items: FlatItem[]) {
  return items.map((i) => ({ section: i.section, title: i.title, url: i.href }));
}

export type RequirementKind = "進級" | "卒業" | "教育課程";

const KIND_QUERIES: Record<RequirementKind, string[]> = {
  進級: ["進級"],
  卒業: ["卒業", "修了"],
  教育課程: ["教育課程", "課程表", "カリキュラム"],
};

/** ページを絞るときに本文に含まれるべき語（教育課程は表が複数ページに続くので絞らない） */
const KIND_PAGE_TERMS: Partial<Record<RequirementKind, string[]>> = {
  進級: ["進級"],
  卒業: ["卒業", "修了"],
};

const REQUIREMENT_LIMITS: Partial<TextLimits> = { maxPages: 8 };
const TOPIC_LIMITS: Partial<TextLimits> = { maxPages: 4 };

export async function lookupRequirements(env: MacroEnv, args: DepartmentArgs & { kind: RequirementKind }): Promise<Outcome> {
  const l = await locateDepartment(env, args);
  if (!l.ok) return l.outcome;
  const page = l.value.page;
  const items = flatten(page);
  const sources: Source[] = [pageSource(page)];

  const scored = items
    .filter((i) => i.pdfUrl)
    .map((i) => {
      const score = Math.max(0, ...KIND_QUERIES[args.kind].map((q) => searchByKeyword(q, [i], (x) => x.title)[0]?.score ?? 0));
      return { i, score };
    })
    .filter((s) => s.score >= 0.5)
    .sort((a, b) => b.score - a.score || a.i.index - b.i.index);
  const best = scored[0]?.i;
  if (!best) {
    return clarify(`「${args.kind}」の要件に当たる項目が学科ページに見つかりません。次の項目から選んでください`, itemCandidates(items), sources, located(l.value));
  }

  const { range, read } = await readItem(env, items, best, REQUIREMENT_LIMITS);
  let pages = read.pages;
  let omittedPages: number[] | undefined;
  const terms = KIND_PAGE_TERMS[args.kind];
  if (terms) {
    const keys = terms.map(normalizeJa);
    const hit = pages.filter((p) => keys.some((k) => normalizeJa(p.text).includes(k)));
    if (hit.length > 0 && hit.length < pages.length) {
      omittedPages = pages.filter((p) => !hit.includes(p)).map((p) => p.page);
      pages = hit;
    }
  }
  sources.push({ title: best.title, url: read.url, pages: pages.map((p) => p.page), lastModified: read.lastModified });
  const data: Record<string, unknown> = {
    ...located(l.value),
    kind: args.kind,
    item: { title: best.title, section: best.section },
    range,
    pages,
  };
  if (omittedPages) data.omittedPages = omittedPages;
  if (read.next) data.next = read.next;
  return ok(data, sources);
}

export async function lookupHandbookTopic(env: MacroEnv, args: DepartmentArgs & { topic: string }): Promise<Outcome> {
  const l = await locateDepartment(env, args);
  if (!l.ok) return l.outcome;
  const page = l.value.page;
  const items = flatten(page);
  const sources: Source[] = [pageSource(page)];
  const hits = searchByKeyword(args.topic, items, (i) => i.title, { limit: 5, minScore: 0.3 });
  const best = hits[0]?.item;
  if (!best) {
    return clarify(`「${args.topic}」に当たる項目が学科ページに見つかりません。次の項目から選んでください`, itemCandidates(items), sources, located(l.value));
  }
  const others = hits.slice(1).map((h) => ({ title: h.item.title, section: h.item.section, url: h.item.href, score: h.score }));
  const itemInfo = { title: best.title, section: best.section, url: best.href };
  if (!best.pdfUrl) {
    return ok({ ...located(l.value), topic: args.topic, item: itemInfo, otherMatches: others }, sources);
  }
  const { range, read } = await readItem(env, items, best, TOPIC_LIMITS);
  sources.push({ title: best.title, url: read.url, pages: read.pages.map((p) => p.page), lastModified: read.lastModified });
  const data: Record<string, unknown> = {
    ...located(l.value),
    topic: args.topic,
    item: itemInfo,
    range,
    pages: read.pages,
    otherMatches: others,
  };
  if (read.next) data.next = read.next;
  return ok(data, sources);
}
