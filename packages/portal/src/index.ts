/**
 * @chibatech-src/portal — 千葉工業大学「学生資料室」ポータルのアトミック操作（非公式）。
 *
 * どの関数も Playwright の `Page` を受け取り、サイト固有の操作を 1 段だけ行う。
 * ブラウザの起動・調達はこのパッケージの外で行う。
 */
import type { Page } from "playwright-core";

export { DEFAULT_BASE_URL, LAYOUT_BREAKPOINT } from "./constants.ts";
export { PortalError, type PortalErrorCode } from "./errors.ts";
export { contextOptions, installRoutes, type PortalContextOptions } from "./context.ts";
export {
  listNews,
  openHome,
  selectDepartment,
  selectStudentType,
  selectYear,
  submitSearch,
  type DepartmentOption,
  type NewsItem,
  type StudentType,
} from "./home.ts";
export { openQuickLink, type QuickLink } from "./quicklinks.ts";
export { listSections, type Section, type SectionItem } from "./sections.ts";
export { DOCUMENT_KINDS, listDocuments, type DocumentCategory, type DocumentItem, type DocumentKind } from "./documents.ts";
export { listContacts, listFaq, type Contact, type FaqItem } from "./inquiry.ts";

/** body の ARIA スナップショット（YAML 風の文字列） */
export function snapshot(page: Page): Promise<string> {
  return page.locator("body").ariaSnapshot();
}
