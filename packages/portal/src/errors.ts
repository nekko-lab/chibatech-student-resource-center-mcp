import type { Page } from "playwright-core";

export type PortalErrorCode = "VALIDATION" | "NOT_FOUND" | "LAYOUT_CHANGED" | "NAVIGATION";

/**
 * ポータル操作の失敗。
 *
 * - `VALIDATION`: 入力が選択肢に無い・サイトが alert で入力を拒んだ
 * - `NOT_FOUND`: 名前で指定したものが見つからない
 * - `LAYOUT_CHANGED`: 期待するセレクタが見つからない。推測で補わず、無かったセレクタを `details` に入れる
 * - `NAVIGATION`: 遷移に失敗した・想定外のページにいる
 */
export class PortalError extends Error {
  readonly code: PortalErrorCode;
  readonly details?: unknown;

  constructor(code: PortalErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "PortalError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export function layoutChanged(page: Page, selector: string, extra: Record<string, unknown> = {}): PortalError {
  return new PortalError("LAYOUT_CHANGED", `期待する要素が見つかりません: ${selector}`, {
    selector,
    url: page.url(),
    ...extra,
  });
}

/** セレクタに一致する要素が 1 つ以上あることを確かめる（無ければ LAYOUT_CHANGED） */
export async function requireSelector(page: Page, selector: string): Promise<number> {
  const n = await page.locator(selector).count();
  if (n === 0) throw layoutChanged(page, selector);
  return n;
}
