import type { Page } from "playwright-core";
import { layoutChanged, requireSelector } from "./errors.ts";
import { normalizeSpace } from "./text.ts";

export interface SectionItem {
  title: string;
  /** 絶対 URL（`#page=N` を含む） */
  href: string;
  /** PDF ならハッシュを除いた PDF の URL */
  pdfUrl?: string;
  /** `#page=N` の N */
  page?: number;
}

export interface Section {
  title: string;
  items: SectionItem[];
}

const COLLAPSE = "article .collapse";
const HEADING = "article h1";

/**
 * 学科・研究科ページの見出しと節（アコーディオン）ごとの項目を読む。
 * アコーディオンの開閉状態には依存せず、DOM から直接読む。
 */
export async function listSections(page: Page): Promise<{ heading: string; sections: Section[] }> {
  await requireSelector(page, COLLAPSE);
  await requireSelector(page, HEADING);

  const heading = normalizeSpace(await page.locator(HEADING).first().textContent());
  const raw = await page.locator(COLLAPSE).evaluateAll((els) =>
    els.map((el) => {
      const title = el.querySelector(".collapse__title");
      const detail = el.querySelector(".collapse__detail");
      if (!title) return { missing: ".collapse__title" };
      if (!detail) return { missing: ".collapse__detail" };
      return {
        title: title.textContent ?? "",
        items: Array.from(detail.querySelectorAll("li a[href]")).map((a) => ({
          title: a.textContent ?? "",
          href: (a as HTMLAnchorElement).href,
        })),
      };
    }),
  );

  const sections: Section[] = [];
  for (const r of raw) {
    if ("missing" in r) throw layoutChanged(page, r.missing ?? ".collapse__title", { within: COLLAPSE });
    sections.push({
      title: normalizeSpace(r.title),
      items: r.items.map((i) => toItem(normalizeSpace(i.title), i.href)),
    });
  }
  return { heading, sections };
}

export function toItem(title: string, href: string): SectionItem {
  const item: SectionItem = { title, href };
  try {
    const u = new URL(href);
    const m = /(?:^#|[#&])page=(\d+)/.exec(u.hash);
    if (/\.pdf$/i.test(u.pathname)) {
      u.hash = "";
      item.pdfUrl = u.href;
    }
    if (m?.[1]) item.page = Number(m[1]);
  } catch {
    // href が URL として読めなければ title と href だけ返す
  }
  return item;
}
