import type { Browser } from "playwright-core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_BASE_URL,
  listNews,
  openHome,
  selectDepartment,
  selectStudentType,
  selectYear,
  submitSearch,
} from "../src/index.ts";
import { FAKE_ALERT_SUBMIT } from "../src/testing/index.ts";
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

describe("openHome", () => {
  it("ホームを開き、NEWS とクイックリンク 10 件を返す", async () => {
    s = await openFake(browser);
    const home = await openHome(s.page);
    expect(home.url).toBe(DEFAULT_BASE_URL);
    expect(home.news).toEqual([
      { date: "2026-04-01", text: "架空年度の資料を掲載しました。" },
      { date: "2026-03-31", text: "架空の担任表と申請様式を更新しました。" },
      { date: "2025-10-01", text: "合成サイトのお知らせです。" },
    ]);
    expect(home.quickLinks).toHaveLength(10);
    expect(home.quickLinks[0]).toEqual({
      title: "時間割・履修の手引き",
      url: `${DEFAULT_BASE_URL}whole/class_guide.html`,
      kind: "html",
    });
    const shuttle = home.quickLinks.find((q) => q.title === "シャトル時刻表");
    expect(shuttle).toEqual({
      title: "シャトル時刻表",
      url: `${DEFAULT_BASE_URL}whole/gakubu/shuttle.pdf`,
      kind: "pdf",
      updated: "2026.09.01",
    });
    expect(home.quickLinks.find((q) => q.title === "食堂メニュー")?.kind).toBe("external");
    expect(home.quickLinks.filter((q) => q.kind === "pdf")).toHaveLength(4);
    expect(home.quickLinks.filter((q) => q.kind === "html")).toHaveLength(5);
  });

  it("baseUrl を差し替えられる", async () => {
    const baseUrl = "http://portal.test/sub/portal/";
    s = await openFake(browser, { baseUrl });
    const home = await openHome(s.page, { baseUrl });
    expect(home.url).toBe(baseUrl);
    expect(home.quickLinks[0]?.url).toBe(`${baseUrl}whole/class_guide.html`);
    expect(s.fake.served.every((u) => u.startsWith(baseUrl))).toBe(true);
  });

  it("ベース URL が 404 なら NAVIGATION", async () => {
    s = await openFake(browser);
    const err = await catchError(openHome(s.page, { baseUrl: `${DEFAULT_BASE_URL}nope/` }));
    expect(err.code).toBe("NAVIGATION");
    expect(err.details).toMatchObject({ status: 404 });
  });

  it("body#home が無ければ LAYOUT_CHANGED（どのセレクタが無かったかを details に入れる）", async () => {
    s = await openFake(browser);
    await s.context.route(DEFAULT_BASE_URL, (r) =>
      r.fulfill({ contentType: "text/html", body: "<!DOCTYPE html><html><body id='other'></body></html>" }),
    );
    const err = await catchError(openHome(s.page));
    expect(err.code).toBe("LAYOUT_CHANGED");
    expect(err.details).toMatchObject({ selector: "body#home" });
  });

  it("NEWS の dl が無ければ LAYOUT_CHANGED", async () => {
    s = await openFake(browser);
    await s.context.route(DEFAULT_BASE_URL, (r) =>
      r.fulfill({ contentType: "text/html", body: fakeHtml("").replace('<section class="news">', '<section class="gone">') }),
    );
    const err = await catchError(openHome(s.page));
    expect(err.code).toBe("LAYOUT_CHANGED");
    expect(err.details).toMatchObject({ selector: "section.news dl" });
  });
});

describe("listNews", () => {
  it("開いているホームから NEWS を読む", async () => {
    s = await openFake(browser);
    await openHome(s.page);
    const news = await listNews(s.page);
    expect(news.map((n) => n.date)).toEqual(["2026-04-01", "2026-03-31", "2025-10-01"]);
  });
});

describe("selectYear", () => {
  it("学部生 2026 の学科（コード・名称）を返す", async () => {
    s = await openFake(browser);
    await openHome(s.page);
    const depts = await selectYear(s.page, 2026);
    expect(depts).toEqual([
      { code: "X1", name: "架空工学科" },
      { code: "Y2", name: "模擬情報学科（2024年度入学～）" },
      { code: "Z3", name: "仮想デザイン学科" },
      { code: "W4", name: "試行未来学科" },
    ]);
  });

  it("年度によってコードが変わる（2020 は 72）", async () => {
    s = await openFake(browser);
    await openHome(s.page);
    const depts = await selectYear(s.page, 2020);
    expect(depts.map((d) => d.code)).toEqual(["X1", "72", "Z3"]);
  });

  it("提示されない年度は VALIDATION（details に選べる年度）", async () => {
    s = await openFake(browser);
    await openHome(s.page);
    const err = await catchError(selectYear(s.page, 2015));
    expect(err.code).toBe("VALIDATION");
    expect(err.details).toMatchObject({ available: [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016] });
  });

  it("ホーム以外で呼ぶと NAVIGATION", async () => {
    s = await openFake(browser);
    await s.page.goto(`${DEFAULT_BASE_URL}whole/link.html`);
    const err = await catchError(selectYear(s.page, 2026));
    expect(err.code).toBe("NAVIGATION");
  });

  it("#slt_year が無ければ LAYOUT_CHANGED", async () => {
    s = await openFake(browser);
    await s.context.route(DEFAULT_BASE_URL, (r) =>
      r.fulfill({ contentType: "text/html", body: fakeHtml("").replace('id="slt_year"', 'id="slt_year_renamed"') }),
    );
    await openHome(s.page);
    const err = await catchError(selectYear(s.page, 2026));
    expect(err.code).toBe("LAYOUT_CHANGED");
    expect(err.details).toMatchObject({ selector: "#slt_year" });
  });
});

describe("selectStudentType", () => {
  it("大学院に切り替えると年度・学科がリセットされ、院の専攻が出る", async () => {
    s = await openFake(browser);
    await openHome(s.page);
    await selectYear(s.page, 2026);
    await selectStudentType(s.page, "graduate");
    expect(await s.page.locator("#slt_year").inputValue()).toBe("");
    expect(await s.page.locator("#slt_dept option").count()).toBe(1);
    expect(await s.page.locator("#rdo_graduate").isChecked()).toBe(true);
    const depts = await selectYear(s.page, 2026);
    expect(depts.map((d) => d.code)).toEqual(["Q1", "Q2", "Q9", "71"]);
  });

  it("学部に戻せる", async () => {
    s = await openFake(browser);
    await openHome(s.page);
    await selectStudentType(s.page, "graduate");
    await selectStudentType(s.page, "undergrad");
    expect(await s.page.locator("#rdo_gakubu").isChecked()).toBe(true);
    expect((await selectYear(s.page, 2026))[0]?.code).toBe("X1");
  });

  it("不正な区分は VALIDATION", async () => {
    s = await openFake(browser);
    await openHome(s.page);
    const err = await catchError(selectStudentType(s.page, "staff" as never));
    expect(err.code).toBe("VALIDATION");
  });
});

describe("selectDepartment", () => {
  it("選択肢にあるコードを選ぶ", async () => {
    s = await openFake(browser);
    await openHome(s.page);
    await selectYear(s.page, 2026);
    await selectDepartment(s.page, "Z3");
    expect(await s.page.locator("#slt_dept").inputValue()).toBe("Z3");
  });

  it("選択肢に無いコードは VALIDATION（details に選択肢）", async () => {
    s = await openFake(browser);
    await openHome(s.page);
    await selectYear(s.page, 2026);
    const err = await catchError(selectDepartment(s.page, "72"));
    expect(err.code).toBe("VALIDATION");
    expect((err.details as { available: { code: string }[] }).available.map((d) => d.code)).toEqual([
      "X1",
      "Y2",
      "Z3",
      "W4",
    ]);
  });

  it("年度が未選択なら VALIDATION（選択肢は空）", async () => {
    s = await openFake(browser);
    await openHome(s.page);
    const err = await catchError(selectDepartment(s.page, "X1"));
    expect(err.code).toBe("VALIDATION");
    expect(err.details).toMatchObject({ available: [] });
  });
});

describe("submitSearch", () => {
  it("学部生 / 2026 / X1 で学科ページへ遷移する", async () => {
    s = await openFake(browser);
    await openHome(s.page);
    await selectYear(s.page, 2026);
    await selectDepartment(s.page, "X1");
    const r = await submitSearch(s.page);
    expect(r.url).toBe(`${DEFAULT_BASE_URL}fic/xeng_2026.html`);
    expect(r.title).toContain("2026年度入学　架空学部 架空工学科");
  });

  it("年度でコードが変わった学科も遷移できる（2024 / Y2）", async () => {
    s = await openFake(browser);
    await openHome(s.page);
    await selectYear(s.page, 2024);
    await selectDepartment(s.page, "Y2");
    expect((await submitSearch(s.page)).url).toBe(`${DEFAULT_BASE_URL}fic2/sim_2024.html`);
  });

  it("院の複数専攻は同じページを共有する", async () => {
    s = await openFake(browser);
    await openHome(s.page);
    await selectStudentType(s.page, "graduate");
    await selectYear(s.page, 2025);
    await selectDepartment(s.page, "Q1");
    const a = await submitSearch(s.page);
    await openHome(s.page);
    await selectStudentType(s.page, "graduate");
    await selectYear(s.page, 2025);
    await selectDepartment(s.page, "Q2");
    const b = await submitSearch(s.page);
    expect(a.url).toBe(`${DEFAULT_BASE_URL}graduate/fiction_2025.html`);
    expect(b.url).toBe(a.url);
  });

  it("未選択で押すと、サイトの alert を VALIDATION に変換する", async () => {
    s = await openFake(browser);
    await openHome(s.page);
    const err = await catchError(submitSearch(s.page));
    expect(err.code).toBe("VALIDATION");
    expect(err.message).toBe(FAKE_ALERT_SUBMIT);
    expect(err.details).toMatchObject({ dialog: FAKE_ALERT_SUBMIT });
    // alert の後もページは操作できる
    expect((await selectYear(s.page, 2026)).length).toBeGreaterThan(0);
  });

  it("年度だけ選んで押しても VALIDATION", async () => {
    s = await openFake(browser);
    await openHome(s.page);
    await selectYear(s.page, 2026);
    const err = await catchError(submitSearch(s.page));
    expect(err.code).toBe("VALIDATION");
  });

  it("遷移先が 404 なら NAVIGATION", async () => {
    s = await openFake(browser);
    await s.context.route(`${DEFAULT_BASE_URL}fic/xeng_2026.html`, (r) =>
      r.fulfill({ status: 404, contentType: "text/html", body: "<html><body>nf</body></html>" }),
    );
    await openHome(s.page);
    await selectYear(s.page, 2026);
    await selectDepartment(s.page, "X1");
    const err = await catchError(submitSearch(s.page));
    expect(err.code).toBe("NAVIGATION");
    expect(err.details).toMatchObject({ status: 404 });
  });
});
