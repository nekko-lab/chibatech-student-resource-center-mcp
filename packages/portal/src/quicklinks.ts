import type { Page } from "playwright-core";
import { PortalError } from "./errors.ts";
import { gotoChecked } from "./navigation.ts";
import { matchKey, normalizeSpace } from "./text.ts";

export interface QuickLink {
  title: string;
  url: string;
  kind: "html" | "pdf" | "external";
  /** 「（更新 2026.09.25）」のような更新注記の日付部分 */
  updated?: string;
}

export const TOP_NAV_LINKS = "section.top_nav li a";
export const SIDE_MENU_LINKS = "aside nav li a";

interface RawLink {
  title: string;
  updated: string;
  href: string;
}

export function classifyLink(url: string, pageUrl: string): QuickLink["kind"] {
  const u = new URL(url);
  let origin = "";
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    origin = "";
  }
  if (u.origin !== origin) return "external";
  return /\.pdf$/i.test(u.pathname) ? "pdf" : "html";
}

function parseUpdated(raw: string): string | undefined {
  const t = normalizeSpace(raw);
  if (!t) return undefined;
  const m = /(\d{4}[./-]\d{1,2}[./-]\d{1,2})/.exec(t);
  if (m?.[1]) return m[1];
  return t.replace(/^[（(]\s*/, "").replace(/\s*[）)]$/, "").replace(/^更新\s*/, "") || undefined;
}

/**
 * クイックリンクを読む。ホームでは `section.top_nav`、それ以外のページではサイドメニュー（`aside nav`）から。
 * どちらも無ければ LAYOUT_CHANGED。
 */
export async function readQuickLinks(page: Page, selectors: readonly string[] = [TOP_NAV_LINKS, SIDE_MENU_LINKS]): Promise<QuickLink[]> {
  for (const sel of selectors) {
    const raw: RawLink[] = await page.locator(sel).evaluateAll((els) =>
      els.map((el) => {
        const a = el as HTMLAnchorElement;
        const spans = Array.from(a.querySelectorAll("span")).filter((s) => !s.classList.contains("updated"));
        const title = spans.length > 0 ? spans.map((s) => s.textContent ?? "").join("") : (a.textContent ?? "");
        return { title, updated: a.querySelector(".updated")?.textContent ?? "", href: a.href };
      }),
    );
    if (raw.length === 0) continue;
    const pageUrl = page.url();
    return raw
      .filter((r) => r.href)
      .map((r) => {
        const q: QuickLink = { title: normalizeSpace(r.title), url: r.href, kind: classifyLink(r.href, pageUrl) };
        const updated = parseUpdated(r.updated);
        if (updated) q.updated = updated;
        return q;
      });
  }
  throw new PortalError("LAYOUT_CHANGED", `クイックリンクが見つかりません: ${selectors.join(" / ")}`, {
    selector: selectors[0],
    selectors: [...selectors],
    url: page.url(),
  });
}

/** 名前でクイックリンクを 1 件に絞る（完全一致 → 部分一致。空白や全角半角の揺れは無視） */
export function pickQuickLink(links: QuickLink[], name: string): QuickLink {
  const key = matchKey(name);
  if (!key) {
    throw new PortalError("VALIDATION", "クイックリンク名が空です", { available: links.map((l) => l.title) });
  }
  const exact = links.filter((l) => matchKey(l.title) === key);
  if (exact.length === 1) return exact[0]!;
  const partial = exact.length > 1 ? exact : links.filter((l) => matchKey(l.title).includes(key));
  if (partial.length === 1) return partial[0]!;
  if (partial.length > 1) {
    throw new PortalError("VALIDATION", `「${name}」に当たるクイックリンクが複数あります`, {
      candidates: partial.map((l) => l.title),
    });
  }
  throw new PortalError("NOT_FOUND", `「${name}」というクイックリンクはありません`, {
    available: links.map((l) => l.title),
  });
}

/** クイックリンクを開く。html だけ遷移し、pdf / external は遷移せず URL を返す */
export async function openQuickLink(page: Page, name: string): Promise<{ url: string; kind: QuickLink["kind"] }> {
  const link = pickQuickLink(await readQuickLinks(page), name);
  if (link.kind !== "html") return { url: link.url, kind: link.kind };
  await gotoChecked(page, link.url);
  return { url: page.url(), kind: "html" };
}
