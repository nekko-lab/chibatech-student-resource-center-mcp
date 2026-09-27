import type { Page } from "playwright-core";
import { layoutChanged, requireSelector } from "./errors.ts";
import { gotoChecked, resolveBaseUrl } from "./navigation.ts";

export interface FaqItem {
  category: string;
  q: string;
  a: string;
}

export interface Contact {
  group: string;
  name: string;
  campus?: string;
  phone?: string;
  hours?: string;
  /** 窓口の全文（行区切り） */
  raw: string;
}

const PATH = "whole/inquiry.html";
const BODY = "body#inquiry";
const FAQ = "article dl.faq";
const BOX = "article .inquiry-box";

interface RawInquiry {
  faq: { category: string; q: string; a: string }[];
  contacts: { group: string; title: string[]; phone: string; hours: string; raw: string; missing?: string }[];
}

async function openInquiry(page: Page, baseUrl: string | undefined, required: string): Promise<RawInquiry> {
  await gotoChecked(page, new URL(PATH, resolveBaseUrl(baseUrl)).href);
  await requireSelector(page, BODY);
  await requireSelector(page, required);
  return page.locator("article").first().evaluate((article) => {
    // 要素を行に分けて文字列にする（ブロック要素と br で改行、表のセルはタブ区切り）。
    // 閉じたアコーディオン（display:none）でも読めるよう、描画に依らず DOM をたどる。
    const BLOCK = new Set([
      "P", "DIV", "LI", "OL", "UL", "H1", "H2", "H3", "H4", "H5", "H6",
      "TABLE", "THEAD", "TBODY", "TR", "DL", "DT", "DD", "FIGURE", "SECTION",
    ]);
    const CELL = "\u0001";
    const textOf = (root: Element | null | undefined, skip?: Element | null): string => {
      if (!root) return "";
      let out = "";
      const walk = (node: Node): void => {
        if (node.nodeType === Node.TEXT_NODE) {
          out += (node.nodeValue ?? "").replace(/[ \t\n\r\f ]+/g, " ");
          return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const el = node as Element;
        if (el === skip || el.tagName === "SCRIPT" || el.tagName === "STYLE" || el.tagName === "IMG") return;
        if (el.tagName === "BR") {
          out += "\n";
          return;
        }
        const block = BLOCK.has(el.tagName);
        if (block) out += "\n";
        for (const c of Array.from(el.childNodes)) walk(c);
        if (el.tagName === "TD" || el.tagName === "TH") out += CELL;
        if (block) out += "\n";
      };
      walk(root);
      return out
        .split("\n")
        .map((l) =>
          l
            .replace(/ *\u0001 */g, CELL)
            .replace(/\u0001+$/, "")
            .replace(/\u0001/g, "\t")
            .replace(/ {2,}/g, " ")
            .trim(),
        )
        .filter(Boolean)
        .join("\n");
    };
    /** 先頭の <span>Q</span> / <span>A</span> のような印 */
    const markOf = (el: Element): Element | null => {
      const first = el.firstElementChild;
      return first && first.tagName === "SPAN" && /^\s*[QA]\s*$/i.test(first.textContent ?? "") ? first : null;
    };

    const faq: RawInquiry["faq"] = [];
    const contacts: RawInquiry["contacts"] = [];
    let heading = "";
    for (const el of Array.from(article.querySelectorAll("h3, dl.faq, .inquiry-box"))) {
      if (el.tagName === "H3") {
        heading = textOf(el).replace(/\n/g, " ");
        continue;
      }
      if (el.matches("dl.faq")) {
        for (const dt of Array.from(el.children)) {
          if (dt.tagName !== "DT") continue;
          const dd = dt.nextElementSibling;
          faq.push({
            category: heading,
            q: textOf(dt, markOf(dt)),
            a: dd && dd.tagName === "DD" ? textOf(dd, markOf(dd)) : "",
          });
        }
        continue;
      }
      const title = el.querySelector("dt.inquiry_block_title");
      contacts.push({
        group: heading,
        title: title ? textOf(title).split("\n") : [],
        phone: textOf(el.querySelector(".inquiry_tel")),
        hours: textOf(el.querySelector(".inquiry_time")).split("\n").join(" "),
        raw: textOf(el),
        ...(title ? {} : { missing: "dt.inquiry_block_title" }),
      });
    }
    return { faq, contacts };
  });
}

/** Q&A（分類・質問・回答）を返す */
export async function listFaq(page: Page, opts: { baseUrl?: string } = {}): Promise<FaqItem[]> {
  const r = await openInquiry(page, opts.baseUrl, FAQ);
  return r.faq;
}

/** お問合せ先（分類・名称・キャンパス・電話・取扱時間・全文）を返す */
export async function listContacts(page: Page, opts: { baseUrl?: string } = {}): Promise<Contact[]> {
  const r = await openInquiry(page, opts.baseUrl, BOX);
  return r.contacts.map((c) => {
    if (c.missing) throw layoutChanged(page, c.missing, { within: BOX });
    const [name = "", second] = c.title;
    const contact: Contact = { group: c.group, name, raw: c.raw };
    if (second && /キャンパス/.test(second)) contact.campus = second;
    else if (c.title.length === 1 && /キャンパス$/.test(name)) contact.campus = name;
    if (c.phone) contact.phone = c.phone;
    if (c.hours) contact.hours = c.hours;
    return contact;
  });
}
