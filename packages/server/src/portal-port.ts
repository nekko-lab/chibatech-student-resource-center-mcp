/**
 * PortalPort のブラウザ実装。マクロ用なので、状態を持つ Page を汚さないよう使い捨ての Page（scratch）で動かす。
 * サイトへのアクセスを減らすため、結果は一定時間（既定 10 分）覚えておく。
 */
import {
  PortalError,
  listContacts,
  listDocuments,
  listFaq,
  listSections,
  openHome,
  selectDepartment,
  selectStudentType,
  selectYear,
  submitSearch,
  type DepartmentOption,
  type DocumentKind,
  type StudentType,
} from "@chibatech-src/portal";
import type { Page } from "playwright-core";
import type { DeptPage, Listing, PortalPort } from "./macros/ports.ts";
import type { Session } from "./session.ts";

export const PORTAL_CACHE_TTL_MS = 10 * 60 * 1000;

export class PortalService implements PortalPort {
  readonly #session: Session;
  readonly #baseUrl: string;
  readonly #ttlMs: number;
  readonly #clock: () => number;
  readonly #cache = new Map<string, { at: number; value: Promise<unknown> }>();

  constructor(session: Session, baseUrl: string, opts: { ttlMs?: number; clock?: () => number } = {}) {
    this.#session = session;
    this.#baseUrl = baseUrl;
    this.#ttlMs = opts.ttlMs ?? PORTAL_CACHE_TTL_MS;
    this.#clock = opts.clock ?? Date.now;
  }

  #cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const hit = this.#cache.get(key);
    if (hit && this.#clock() - hit.at < this.#ttlMs) return hit.value as Promise<T>;
    const value = fn();
    this.#cache.set(key, { at: this.#clock(), value });
    value.catch(() => this.#cache.delete(key));
    return value;
  }

  #scratch<T>(fn: (page: Page) => Promise<T>): Promise<T> {
    return this.#session.scratch(fn);
  }

  async #listing<T>(page: Page, items: T): Promise<Listing<T>> {
    const url = page.url();
    return { url, title: (await page.title()).trim(), items, lastModified: this.#session.lastModified(url) };
  }

  async #homeWithType(page: Page, type: StudentType): Promise<void> {
    await openHome(page, { baseUrl: this.#baseUrl });
    await selectStudentType(page, type);
  }

  years(type: StudentType): Promise<number[]> {
    return this.#cached(`years:${type}`, () =>
      this.#scratch(async (page) => {
        await this.#homeWithType(page, type);
        // 選べる年度の一覧を返す API が無いので、選べない値を渡して VALIDATION の details.available を読む
        try {
          await selectYear(page, -1);
        } catch (e) {
          const available = e instanceof PortalError ? (e.details as { available?: unknown } | undefined)?.available : undefined;
          if (Array.isArray(available)) return available.filter((y): y is number => typeof y === "number");
          throw e;
        }
        return [];
      }),
    );
  }

  departments(type: StudentType, year: number): Promise<DepartmentOption[]> {
    return this.#cached(`departments:${type}:${year}`, () =>
      this.#scratch(async (page) => {
        await this.#homeWithType(page, type);
        return selectYear(page, year);
      }),
    );
  }

  departmentPage(type: StudentType, year: number, code: string): Promise<DeptPage> {
    return this.#cached(`departmentPage:${type}:${year}:${code}`, () =>
      this.#scratch(async (page) => {
        await this.#homeWithType(page, type);
        await selectYear(page, year);
        await selectDepartment(page, code);
        const { url } = await submitSearch(page);
        const { heading, sections } = await listSections(page);
        return { url, heading, sections, lastModified: this.#session.lastModified(url) };
      }),
    );
  }

  quickLinks() {
    return this.#cached("quickLinks", () =>
      this.#scratch(async (page) => {
        const home = await openHome(page, { baseUrl: this.#baseUrl });
        return this.#listing(page, home.quickLinks);
      }),
    );
  }

  documents(kind: DocumentKind) {
    return this.#cached(`documents:${kind}`, () =>
      this.#scratch(async (page) => this.#listing(page, await listDocuments(page, kind, { baseUrl: this.#baseUrl }))),
    );
  }

  faq() {
    return this.#cached("faq", () => this.#scratch(async (page) => this.#listing(page, await listFaq(page, { baseUrl: this.#baseUrl }))));
  }

  contacts() {
    return this.#cached("contacts", () =>
      this.#scratch(async (page) => this.#listing(page, await listContacts(page, { baseUrl: this.#baseUrl }))),
    );
  }
}
