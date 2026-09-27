/**
 * PDF の本文を横断して探すマクロ: search_documents
 *
 * 項目名で当たりを付ける他のマクロでは見つからない語（「GPA」「再履修」「学割」「追試」など）のためのもの。
 *
 * - 対象: 学生の学科（研究科）ページの PDF、クイックリンクの PDF、「各種申請書・マニュアル」の PDF。
 *   学科長・クラス担任表は個人名の一覧なので入れない。doc / xlsx・要ログイン・ポータル外（Google Drive など）も入れない
 * - 本文そのものは返さず、ページごとに短い抜粋だけを返す（続きは document_read_text）
 * - 索引作りが時間の上限に達したら、それまでの分で検索して status: "partial" を返す
 */
import { normalizeJa } from "@chibatech-src/match";
import { PortalError, type DocumentItem } from "@chibatech-src/portal";
import { fileNameOf } from "../docs.ts";
import { ok, partial, type Outcome, type Source } from "../respond.ts";
import { makeExcerpts } from "../search/excerpt.ts";
import type { CorpusDoc, DocumentIndex, UpdateReport } from "../search/indexer.ts";
import { parseQuery } from "../search/query.ts";
import type { PageHit, TermHit } from "../search/rank.ts";
import type { DeptPage, MacroEnv } from "./ports.ts";
import { TEACHER_ALIASES } from "./quicklink.ts";
import { locateDepartment, type DepartmentArgs } from "./resolve.ts";

export const DEFAULT_SEARCH_LIMIT = 8;
export const MAX_SEARCH_LIMIT = 20;
/** 応答の JSON（整形後）の上限 */
export const MAX_OUTPUT_CHARS = 6_000;
/** 応答に載せる取得失敗の件数の上限 */
const MAX_FAILED_SHOWN = 5;

/** 個人名の一覧なので索引に入れないクイックリンク */
export const PERSONAL_LIST_ALIASES: readonly string[] = [...TEACHER_ALIASES, "学科長"];

export interface CorpusEntry extends CorpusDoc {
  origin: "department" | "quick_link" | "manual";
  /** 学科ページの項目（その PDF の何ページ目から始まるか） */
  parts?: { title: string; page: number }[];
}

export interface Corpus {
  docs: CorpusEntry[];
  /** 索引に入れなかったもの（理由つき） */
  excluded: { title: string; url: string; reason: string }[];
  /** 読めなかった一覧（ほかの一覧の分だけで続ける） */
  unavailable: { listing: string; error: string }[];
}

const hostOf = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return "";
  }
};

const stripHash = (u: string) => {
  try {
    const x = new URL(u);
    x.hash = "";
    return x.href;
  } catch {
    return u;
  }
};

function extOf(i: DocumentItem): string {
  if (i.ext) return i.ext.toLowerCase();
  try {
    const m = new URL(i.url).pathname.match(/\.([0-9a-z]+)$/i);
    return m ? m[1]!.toLowerCase() : "";
  } catch {
    return "";
  }
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 検索の対象にする PDF を集める（URL の重複を除く。先に集めたものを残す） */
export async function collectCorpus(env: MacroEnv, dept: DeptPage | undefined): Promise<Corpus> {
  const docs = new Map<string, CorpusEntry>();
  const excluded: Corpus["excluded"] = [];
  const unavailable: Corpus["unavailable"] = [];

  if (dept) {
    const host = hostOf(dept.url);
    for (const s of dept.sections) {
      for (const it of s.items) {
        if (!it.pdfUrl) continue;
        const url = stripHash(it.pdfUrl);
        if (hostOf(url) !== host) {
          excluded.push({ title: it.title, url, reason: "ポータルの外の URL" });
          continue;
        }
        let d = docs.get(url);
        if (!d) {
          d = { url, title: fileNameOf(url), origin: "department", parts: [] };
          docs.set(url, d);
        }
        d.parts!.push({ title: it.title, page: it.page ?? 1 });
      }
    }
  }

  try {
    const home = await env.portal.quickLinks();
    const host = hostOf(home.url);
    const personal = PERSONAL_LIST_ALIASES.map(normalizeJa);
    for (const l of home.items) {
      if (l.kind !== "pdf") continue;
      const url = stripHash(l.url);
      const key = normalizeJa(l.title);
      if (personal.some((p) => key.includes(p))) {
        excluded.push({ title: l.title, url, reason: "個人名の一覧のため索引に入れない" });
        continue;
      }
      if (hostOf(url) !== host) {
        excluded.push({ title: l.title, url, reason: "ポータルの外の URL" });
        continue;
      }
      if (!docs.has(url)) docs.set(url, { url, title: l.title, origin: "quick_link" });
    }
  } catch (e) {
    unavailable.push({ listing: "クイックリンク", error: errorText(e) });
  }

  try {
    const manual = await env.portal.documents("manual");
    const host = hostOf(manual.url);
    for (const c of manual.items) {
      for (const i of c.items) {
        const url = stripHash(i.url);
        const ext = extOf(i);
        let reason: string | undefined;
        if (ext !== "pdf") reason = `PDF ではない（${ext || "拡張子なし"}）`;
        else if (i.requiresLogin) reason = "要ログイン";
        else if (hostOf(url) !== host) reason = "ポータルの外の URL";
        if (reason) {
          excluded.push({ title: i.title, url, reason });
          continue;
        }
        if (!docs.has(url)) docs.set(url, { url, title: i.title, origin: "manual" });
      }
    }
  } catch (e) {
    unavailable.push({ listing: "各種申請書・マニュアル", error: errorText(e) });
  }

  return { docs: [...docs.values()], excluded, unavailable };
}

export interface SearchArgs extends DepartmentArgs {
  query: string;
  limit?: number | undefined;
}

/** 当たったページを含む学科ページの項目（同じページから始まる項目が複数なら後のもの） */
function partTitle(doc: CorpusEntry, page: number): string | undefined {
  let best: string | undefined;
  for (const p of doc.parts ?? []) if (p.page <= page) best = p.title;
  return best;
}

function termLabel(t: TermHit): string {
  switch (t.kind) {
    case "literal":
      return t.term;
    case "synonym":
      return `${t.term}（同義語「${t.display}」）`;
    case "part":
      return `${t.term}（語の一部「${t.display}」）`;
    case "part_synonym":
      return `${t.term}（語の一部の同義語「${t.display}」）`;
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

interface HitOut {
  title: string;
  document?: string;
  url: string;
  page: number;
  lastModified: string | null;
  matchedTerms: string[];
  excerpts: string[];
  score: number;
}

function hitOut(h: PageHit, doc: CorpusEntry, lastModified: string | null): HitOut {
  const part = partTitle(doc, h.ref.page);
  return {
    title: part ?? doc.title,
    ...(part && part !== doc.title ? { document: doc.title } : {}),
    url: h.ref.url,
    page: h.ref.page,
    lastModified,
    matchedTerms: h.terms.map(termLabel),
    excerpts: makeExcerpts(h),
    score: round2(h.score),
  };
}

function sourcesOf(hits: HitOut[], byUrl: Map<string, CorpusEntry>): Source[] {
  const m = new Map<string, Source>();
  for (const h of hits) {
    let s = m.get(h.url);
    if (!s) {
      s = { title: byUrl.get(h.url)?.title ?? h.title, url: h.url, pages: [], lastModified: h.lastModified };
      m.set(h.url, s);
    }
    if (!s.pages!.includes(h.page)) s.pages!.push(h.page);
  }
  for (const s of m.values()) s.pages!.sort((a, b) => a - b);
  return [...m.values()];
}

/** 整形後の JSON が上限に収まるまで、下位の当たりから落とす */
export function fitHits(
  hits: HitOut[],
  build: (hits: HitOut[]) => { status: string; data: Record<string, unknown>; sources: Source[] },
  maxChars: number = MAX_OUTPUT_CHARS,
): { kept: HitOut[]; omitted: number } {
  let n = hits.length;
  const size = (k: number) => {
    const b = build(hits.slice(0, k));
    return JSON.stringify({ status: b.status, ...b.data, sources: b.sources }, null, 2).length;
  };
  while (n > 0 && size(n) > maxChars) n--;
  return { kept: hits.slice(0, n), omitted: hits.length - n };
}

function indexInfo(r: UpdateReport, corpus: Corpus): Record<string, unknown> {
  const out: Record<string, unknown> = { indexed: r.indexed, total: r.total, complete: r.complete, builtNow: r.built };
  if (r.failed.length > 0) {
    out.failed = r.failed.slice(0, MAX_FAILED_SHOWN).map((f) => ({ title: f.title, url: f.url, error: f.error.slice(0, 120) }));
    if (r.failed.length > MAX_FAILED_SHOWN) out.failedMore = r.failed.length - MAX_FAILED_SHOWN;
  }
  if (corpus.excluded.length > 0) out.excluded = corpus.excluded.length;
  if (corpus.unavailable.length > 0) out.unavailableListings = corpus.unavailable.map((u) => u.listing);
  return out;
}

const HOW_TO_READ =
  "本文は抜粋だけです。続きは document_read_text に url と from / to（page の値）を渡して読んでください。回答には資料名・URL・ページを添えてください";

export async function searchDocuments(env: MacroEnv, index: DocumentIndex, args: SearchArgs): Promise<Outcome> {
  const startedAt = index.now();
  const terms = parseQuery(args.query ?? "");
  if (terms.length === 0) throw new PortalError("VALIDATION", "検索語を指定してください", { query: args.query });
  const limit = Math.min(MAX_SEARCH_LIMIT, Math.max(1, Math.trunc(args.limit ?? DEFAULT_SEARCH_LIMIT)));

  // 区分・年度・学科: 引数で 1 つでも指定されたか、プロフィールで揃えば学科ページを使う。どちらでもなければ共通の資料だけ
  const p = env.profile;
  const explicit = Boolean(args.studentType?.trim() || (args.year !== undefined && String(args.year).trim()) || args.department?.trim());
  const profileComplete = Boolean(p.studentType && p.admissionYear && p.department);
  const notes: string[] = [];
  const data: Record<string, unknown> = { query: args.query.trim() };
  let dept: DeptPage | undefined;
  if (explicit || profileComplete) {
    const l = await locateDepartment(env, args);
    if (!l.ok) return l.outcome;
    dept = l.value.page;
    Object.assign(data, {
      scope: "department",
      studentType: l.value.studentType,
      admissionYear: l.value.admissionYear,
      department: { code: l.value.department.code, name: l.value.department.name },
    });
  } else {
    data.scope = "common";
    notes.push(
      "区分・入学年度・学科が分からないため、共通の資料（クイックリンク・各種申請書・マニュアルの PDF）だけを検索しました。学科の資料も探すなら、区分・入学年度・学科を指定してください",
    );
  }

  const corpus = await collectCorpus(env, dept);
  const report = await index.update(corpus.docs, env.docs, { startedAt });
  const byUrl = new Map(corpus.docs.map((d) => [d.url, d]));
  const result = index.search(terms, { limit, urls: new Set(byUrl.keys()) });
  const hits = result.hits.map((h) => hitOut(h, byUrl.get(h.ref.url)!, index.meta(h.ref.url)?.lastModified ?? null));

  if (result.mode === "some") notes.push("すべての語を含むページが無かったため、一部の語を含むページを返します（一致した語の多い順）");
  if (result.mode === "none") {
    notes.push(
      `「${args.query.trim()}」に当たるページが見つかりません。語を減らす・言い換えるか、項目名で探すマクロ（lookup_handbook_topic / find_manual など）も試してください`,
    );
  }
  if (!report.complete && result.mode === "none") notes.push("索引の作成が途中のため、まだ探せていない資料があります");

  const status = report.complete ? "ok" : "partial";
  const build = (kept: HitOut[]) => {
    const d: Record<string, unknown> = { ...data };
    if (notes.length > 0) d.note = notes.join(" ");
    d.matchMode = result.mode;
    d.hits = kept;
    if (kept.length < hits.length) d.omittedHits = hits.length - kept.length;
    d.index = indexInfo(report, corpus);
    if (!report.complete) {
      d.progress = { indexed: report.indexed, total: report.total };
      d.hint = `索引の作成が途中です（済み ${report.indexed} / 全 ${report.total} 本）。この結果は索引を作り終えた資料だけから探したものです。もう一度同じ引数で search_documents を呼ぶと、続きから索引を作ります`;
    }
    d.howToRead = HOW_TO_READ;
    return { status, data: d, sources: sourcesOf(kept, byUrl) };
  };
  const { kept } = fitHits(hits, build);
  const out = build(kept);
  return status === "ok" ? ok(out.data, out.sources) : partial(out.data, out.sources);
}
