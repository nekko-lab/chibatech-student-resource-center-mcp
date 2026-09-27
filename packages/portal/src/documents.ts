import type { Page } from "playwright-core";
import { PortalError, requireSelector } from "./errors.ts";
import { gotoChecked, resolveBaseUrl } from "./navigation.ts";
import { extOf, normalizeSpace, splitNotes } from "./text.ts";

export type DocumentKind = "manual" | "absence" | "class_guide" | "handbook" | "links";

export interface DocumentItem {
  title: string;
  url: string;
  /** URL のパス末尾の拡張子（pdf / doc / xlsx / html など）。無ければ省略 */
  ext?: string;
  /** 「ログインしてください」等の注記があるか */
  requiresLogin: boolean;
  /** 名称に付いた注記・取扱窓口・リンクの説明 */
  note?: string;
}

export interface DocumentCategory {
  category: string;
  items: DocumentItem[];
}

interface DocPage {
  path: string;
  body: string;
  /** 1 件以上あるべき要素 */
  required: string;
  /** article 内で拾うリンク */
  links: string;
}

const PAGES: Record<DocumentKind, DocPage> = {
  manual: {
    path: "whole/web_manual.html",
    body: "body#web_manual",
    required: "article table tbody tr",
    links: "table tbody tr td a[href]",
  },
  absence: {
    path: "whole/absence.html",
    body: "body#absence",
    required: "article ul.btn_link_list li a",
    links: "ul.btn_link_list li a[href]",
  },
  class_guide: {
    path: "whole/class_guide.html",
    body: "body#class_guide",
    required: "article ul.btn_link_list li a",
    links: "ul.btn_link_list li a[href]",
  },
  handbook: {
    path: "whole/handbook.html",
    body: "body#handbook",
    required: "article ul.handbook_list li a",
    links: "ul.handbook_list li a[href]",
  },
  links: {
    path: "whole/link.html",
    body: "body#link",
    required: "article dl.link_list dt a",
    links: "dl.link_list dt a[href]",
  },
};

export const DOCUMENT_KINDS = Object.keys(PAGES) as DocumentKind[];

const LOGIN_RE = /ログイン|学生専用/;

/**
 * 共通ページ（各種申請書・欠席届・授業時間表・学生便覧・外部サイトリンク）を開き、
 * 見出し（h2。無ければ h1）ごとに文書を返す。
 */
export async function listDocuments(
  page: Page,
  kind: DocumentKind,
  opts: { baseUrl?: string } = {},
): Promise<DocumentCategory[]> {
  if (!Object.hasOwn(PAGES, kind)) {
    throw new PortalError("VALIDATION", `文書の種類が不正です: ${String(kind)}`, { available: DOCUMENT_KINDS });
  }
  const def = PAGES[kind];
  const base = resolveBaseUrl(opts.baseUrl);
  await gotoChecked(page, new URL(def.path, base).href);
  await requireSelector(page, def.body);
  await requireSelector(page, def.required);

  const groups = await page.locator("article").first().evaluate(
    (article, { linkSel, kind }) => {
      const norm = (s: string | null | undefined): string => (s ?? "").replace(/[ \t\n\r\f ]+/g, " ").trim();
      const h1 = norm(article.querySelector("h1")?.textContent);
      const out: { category: string; items: { raw: string; url: string; extra?: string }[] }[] = [];
      let cur: (typeof out)[number] | null = null;
      for (const el of Array.from(article.querySelectorAll(`h2, ${linkSel}`))) {
        if (el.tagName === "H2") {
          cur = { category: norm(el.textContent), items: [] };
          out.push(cur);
          continue;
        }
        if (!cur) {
          cur = { category: h1, items: [] };
          out.push(cur);
        }
        const a = el as HTMLAnchorElement;
        let extra: string | undefined;
        if (kind === "manual") {
          const td = a.closest("td");
          const tr = a.closest("tr");
          const others = tr
            ? Array.from(tr.children)
                .filter((c) => c !== td)
                .map((c) => norm(c.textContent))
                .filter(Boolean)
            : [];
          if (others.length > 0) extra = `取扱窓口：${others.join(" / ")}`;
        } else if (kind === "links") {
          const dd = a.closest("dt")?.nextElementSibling;
          if (dd && dd.tagName === "DD") extra = norm(dd.textContent).replace(/^[…‥.]+\s*/, "") || undefined;
        }
        cur.items.push({ raw: norm(a.textContent), url: a.href, ...(extra ? { extra } : {}) });
      }
      return out.filter((g) => g.items.length > 0);
    },
    { linkSel: def.links, kind },
  );

  return groups.map((g) => ({
    category: g.category,
    items: g.items.map((i) => {
      const { title, notes } = splitNotes(normalizeSpace(i.raw));
      const item: DocumentItem = { title, url: i.url, requiresLogin: LOGIN_RE.test(i.raw) };
      const ext = extOf(i.url);
      if (ext) item.ext = ext;
      const note = [...notes, ...(i.extra ? [i.extra] : [])].join(" / ");
      if (note) item.note = note;
      return item;
    }),
  }));
}
