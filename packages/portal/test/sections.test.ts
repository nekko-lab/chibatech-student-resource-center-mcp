import type { Browser } from "playwright-core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_BASE_URL,
  listSections,
  openHome,
  selectDepartment,
  selectStudentType,
  selectYear,
  submitSearch,
} from "../src/index.ts";
import { catchError, fakeHtml, launch, openFake, type FakeSession } from "./helpers.ts";

let browser: Browser;
let s: FakeSession;
beforeAll(async () => {
  browser = await launch();
});
afterAll(async () => {
  await browser?.close();
});
afterEach(async () => {
  await s?.context.close();
});

const B = DEFAULT_BASE_URL;

describe("listSections", () => {
  it("学科ページの見出し・節・項目（絶対 URL・PDF・ページ番号）を返す", async () => {
    s = await openFake(browser);
    await openHome(s.page);
    await selectYear(s.page, 2026);
    await selectDepartment(s.page, "X1");
    await submitSearch(s.page);

    const r = await listSections(s.page);
    expect(r.heading).toBe("2026年度入学　架空学部 架空工学科");
    expect(r.sections.map((x) => x.title)).toEqual([
      "架空の生活案内",
      "架空の修学案内",
      "架空の要件と課程表",
      "架空の進路案内",
      "架空の規程集",
    ]);
    const life = r.sections[0]!;
    expect(life.items[0]).toEqual({
      title: "架空の年間行事",
      href: `${B}fic/common_2026/life.pdf#page=1`,
      pdfUrl: `${B}fic/common_2026/life.pdf`,
      page: 1,
    });
    // 同じページ番号を共有する項目は両方残す
    const p13 = life.items.filter((i) => i.page === 13);
    expect(p13.map((i) => i.title)).toEqual(["架空のクラス担任", "架空の通学案内"]);

    // ページ番号の無い PDF
    const office = r.sections[2]!.items.find((i) => i.title === "架空の教員室一覧");
    expect(office).toEqual({
      title: "架空の教員室一覧",
      href: `${B}fic/common_2026/office.pdf`,
      pdfUrl: `${B}fic/common_2026/office.pdf`,
    });

    // 親ディレクトリへの相対リンクも絶対 URL に解決する
    expect(r.sections[3]!.items[1]).toEqual({
      title: "架空のアルバイト案内",
      href: `${B}whole/shinro/job_2026.pdf#page=2`,
      pdfUrl: `${B}whole/shinro/job_2026.pdf`,
      page: 2,
    });
  });

  it("幅 737px 未満（アコーディオンが閉じた状態）でも同じ結果を読む", async () => {
    s = await openFake(browser);
    await s.page.goto(`${B}fic/xeng_2026.html`);
    const wide = await listSections(s.page);
    await s.context.close();

    s = await openFake(browser, { viewport: { width: 500, height: 800 } });
    await s.page.goto(`${B}fic/xeng_2026.html`);
    expect(await s.page.locator(".collapse__detail").first().isVisible()).toBe(false);
    const narrow = await listSections(s.page);
    expect(narrow).toEqual(wide);
  });

  it("研究科ページは節構成が違う", async () => {
    s = await openFake(browser);
    await openHome(s.page);
    await selectStudentType(s.page, "graduate");
    await selectYear(s.page, 2026);
    await selectDepartment(s.page, "Q9");
    await submitSearch(s.page);
    const r = await listSections(s.page);
    expect(r.heading).toBe("2026年度入学　大学院 架空工学研究科");
    expect(r.sections.map((x) => x.title)).toEqual(["架空の概要", "架空の修学案内", "架空の手続案内", "架空工学研究科"]);
    expect(r.sections[0]!.items.filter((i) => i.page === 5)).toHaveLength(2);
  });

  it("学科ページでなければ LAYOUT_CHANGED（details にセレクタ）", async () => {
    s = await openFake(browser);
    await openHome(s.page);
    const err = await catchError(listSections(s.page));
    expect(err.code).toBe("LAYOUT_CHANGED");
    expect(err.details).toMatchObject({ selector: "article .collapse" });
  });

  it("節見出しの要素が無ければ LAYOUT_CHANGED", async () => {
    s = await openFake(browser);
    const path = "fic/xeng_2026.html";
    await s.context.route(`${B}${path}`, (r) =>
      r.fulfill({ contentType: "text/html", body: fakeHtml(path).replaceAll("collapse__title", "collapse__name") }),
    );
    await s.page.goto(`${B}${path}`);
    const err = await catchError(listSections(s.page));
    expect(err.code).toBe("LAYOUT_CHANGED");
    expect(err.details).toMatchObject({ selector: ".collapse__title" });
  });
});
