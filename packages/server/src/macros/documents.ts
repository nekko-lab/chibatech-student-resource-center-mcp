/**
 * 共通ページを起点にするマクロ: find_manual / get_absence_form / find_contact
 */
import { normalizeJa, resolveStudentType, searchByKeyword } from "@chibatech-src/match";
import { PortalError, type Contact, type DocumentItem, type FaqItem } from "@chibatech-src/portal";
import { clarify, ok, type Outcome, type Source } from "../respond.ts";
import type { MacroEnv } from "./ports.ts";
import { pageSource, resolveType } from "./resolve.ts";

function docInfo(i: DocumentItem, category?: string): Record<string, unknown> {
  const out: Record<string, unknown> = { title: i.title };
  if (category !== undefined) out.category = category;
  out.url = i.url;
  if (i.ext) out.ext = i.ext;
  out.requiresLogin = i.requiresLogin;
  if (i.note) out.note = i.note;
  return out;
}

export async function findManual(env: MacroEnv, args: { keyword: string }): Promise<Outcome> {
  const listing = await env.portal.documents("manual");
  const sources = [pageSource(listing)];
  const flat = listing.items.flatMap((c) => c.items.map((i) => ({ ...i, category: c.category })));
  const hits = searchByKeyword(args.keyword, flat, (i) => `${i.title} ${i.note ?? ""}`, { limit: 8, minScore: 0.3 });
  if (hits.length === 0) {
    return clarify(
      `「${args.keyword}」に当たる申請書・マニュアルが見つかりません。次から選んでください`,
      listing.items.map((c) => ({ category: c.category, titles: c.items.map((i) => i.title) })),
      sources,
    );
  }
  return ok({ keyword: args.keyword, matches: hits.map((h) => docInfo(h.item, h.item.category)) }, sources);
}

export async function getAbsenceForm(
  env: MacroEnv,
  args: { studentType?: string | undefined; form?: string | undefined; save?: boolean | undefined },
): Promise<Outcome> {
  const type = resolveType(env, args.studentType);
  if (!type.ok) return type.outcome;
  const listing = await env.portal.documents("absence");
  const sources: Source[] = [pageSource(listing)];
  const category = listing.items.find((c) => resolveStudentType(c.category) === type.value);
  if (!category) {
    throw new PortalError("LAYOUT_CHANGED", "欠席届のページに区分（学部 / 大学院）の見出しが見つかりません", {
      selector: "article h2",
      url: listing.url,
      categories: listing.items.map((c) => c.category),
    });
  }
  let items = category.items;
  const form = args.form?.trim();
  if (form) {
    const hits = searchByKeyword(form, items, (i) => i.title, { minScore: 0.3 });
    if (hits.length === 0) {
      return clarify(`「${form}」に当たる様式が見つかりません。次から選んでください`, items.map((i) => i.title), sources);
    }
    items = hits.map((h) => h.item);
  }
  const forms: Record<string, unknown>[] = [];
  for (const i of items) {
    const f = docInfo(i);
    if (args.save) {
      const d = await env.docs.download(i.url);
      f.savedTo = d.path;
      sources.push({ title: i.title, url: d.url, lastModified: d.lastModified });
    }
    forms.push(f);
  }
  return ok({ studentType: type.value, category: category.category, forms }, sources);
}

const MAX_ANSWER_CHARS = 1500;

function contactInfo(c: Contact): Record<string, unknown> {
  const out: Record<string, unknown> = { group: c.group, name: c.name };
  if (c.campus) out.campus = c.campus;
  if (c.phone) out.phone = c.phone;
  if (c.hours) out.hours = c.hours;
  out.detail = c.raw;
  return out;
}

function faqInfo(f: FaqItem): Record<string, unknown> {
  const a = f.a.length > MAX_ANSWER_CHARS ? `${f.a.slice(0, MAX_ANSWER_CHARS)}…（以下略。原本を確認してください）` : f.a;
  return { category: f.category, q: f.q, a };
}

export async function findContact(env: MacroEnv, args: { query: string }): Promise<Outcome> {
  const faq = await env.portal.faq();
  const contacts = await env.portal.contacts();
  const sources: Source[] = [pageSource(faq)];
  if (contacts.url !== faq.url) sources.push(pageSource(contacts));

  const faqHits = searchByKeyword(args.query, faq.items, (f) => `${f.category} ${f.q} ${f.a}`, { limit: 3, minScore: 0.3 }).map((h) => h.item);
  const found = searchByKeyword(args.query, contacts.items, (c) => `${c.group} ${c.name} ${c.raw}`, { limit: 3, minScore: 0.3 }).map(
    (h) => h.item,
  );
  // Q&A の回答に名前が出てくる窓口も挙げる
  const answers = normalizeJa(faqHits.map((f) => f.a).join("\n"));
  for (const c of contacts.items) {
    const key = normalizeJa(c.name);
    if (key.length >= 2 && answers.includes(key) && !found.includes(c)) found.push(c);
  }
  if (faqHits.length === 0 && found.length === 0) {
    return clarify(`「${args.query}」に当たる Q&A・窓口が見つかりません。次の窓口から選んでください`, contacts.items.map((c) => c.name), sources);
  }
  return ok({ query: args.query, faq: faqHits.map(faqInfo), contacts: found.map(contactInfo) }, sources);
}
