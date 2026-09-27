import type { Browser } from "playwright-core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_BASE_URL, listDocuments } from "../src/index.ts";
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

describe("listDocuments", () => {
  it("manual: 分類ごとの文書（拡張子・要ログイン・注記・取扱窓口）", async () => {
    s = await openFake(browser);
    const r = await listDocuments(s.page, "manual");
    expect(s.page.url()).toBe(`${B}whole/web_manual.html`);
    expect(r.map((c) => c.category)).toEqual(["架空の学生生活", "架空の授業・学位", "架空のネットワーク", "架空のその他"]);

    const [life, lesson, net] = r;
    expect(life!.items[0]).toEqual({
      title: "架空の学びの手引き",
      url: `${B}whole/web_manual/cat_01_01.pdf`,
      ext: "pdf",
      requiresLogin: false,
      note: "取扱窓口：架空センター（学生係）",
    });
    // クエリ付きでも拡張子はパスから取る
    expect(life!.items[1]).toMatchObject({ url: `${B}whole/web_manual/cat_01_02.pdf?20260101_01`, ext: "pdf" });
    expect(life!.items[2]).toMatchObject({ url: `${B}whole/fake_archive.html`, ext: "html" });

    expect(lesson!.items.map((i) => i.ext)).toEqual(["pdf", "xlsx", "doc"]);
    expect(lesson!.items[1]).toMatchObject({
      title: "架空の先取り履修志願書",
      note: "※架空学年対象 / 取扱窓口：架空センター（教務係）",
      requiresLogin: false,
    });

    expect(net!.items.map((i) => i.requiresLogin)).toEqual([true, false, true]);
    expect(net!.items[0]).toEqual({
      title: "架空の学内ネットワーク案内",
      url: "https://drive.example.com/drive/folders/fake-network",
      requiresLogin: true,
      note: "※学生専用/架空アカウントでログインしてください / 取扱窓口：架空部（情報係）",
    });
    expect(net!.items[0]).not.toHaveProperty("ext");
  });

  it("absence: 学部／大学院", async () => {
    s = await openFake(browser);
    const r = await listDocuments(s.page, "absence");
    expect(r).toEqual([
      {
        category: "学部",
        items: [
          { title: "欠席連絡票", url: `${B}whole/gakubu/absence_form.pdf`, ext: "pdf", requiresLogin: false },
          { title: "受診記録票", url: `${B}whole/gakubu/medical_record.pdf`, ext: "pdf", requiresLogin: false },
        ],
      },
      {
        category: "大学院",
        items: [
          { title: "欠席連絡票", url: `${B}whole/graduate/absence_form.pdf`, ext: "pdf", requiresLogin: false },
          { title: "受診記録票", url: `${B}whole/gakubu/medical_record.pdf`, ext: "pdf", requiresLogin: false },
        ],
      },
    ]);
  });

  it("class_guide: 学部別の外部（Drive 相当）リンク", async () => {
    s = await openFake(browser);
    const r = await listDocuments(s.page, "class_guide");
    expect(r.map((c) => c.category)).toEqual(["学部", "大学院"]);
    expect(r[0]!.items.map((i) => i.title)).toEqual(["架空工学部", "模擬情報学部", "仮想デザイン学部"]);
    expect(r[0]!.items[0]).toEqual({
      title: "架空工学部",
      url: "https://drive.example.com/file/d/fake-eng/view",
      requiresLogin: false,
    });
  });

  it("handbook: 年度 × 学部（改行を含む名称は連結する）", async () => {
    s = await openFake(browser);
    const r = await listDocuments(s.page, "handbook");
    expect(r.map((c) => c.category)).toEqual(["2026年度入学生用", "2025年度入学生用", "2024年度入学生用"]);
    expect(r[0]!.items).toEqual([
      { title: "架空工学部", url: `${B}whole/handbook/handbook_2026_fic.pdf`, ext: "pdf", requiresLogin: false },
      { title: "模擬情報学部", url: `${B}whole/handbook/handbook_2026_sim.pdf`, ext: "pdf", requiresLogin: false },
      { title: "大学院", url: `${B}whole/handbook/handbook_2026_graduate.pdf`, ext: "pdf", requiresLogin: false },
    ]);
  });

  it("links: dt/dd の外部サイト（説明は note）", async () => {
    s = await openFake(browser);
    const r = await listDocuments(s.page, "links");
    expect(r).toHaveLength(1);
    expect(r[0]!.category).toBe("関連サイト");
    expect(r[0]!.items).toHaveLength(4);
    expect(r[0]!.items[0]).toEqual({
      title: "架空ポータル",
      url: "https://portal.example.com/",
      requiresLogin: false,
      note: "架空のポータルサイト",
    });
    expect(r[0]!.items[3]).toEqual({ title: "架空大学HP", url: "https://www.example.com/", requiresLogin: false });
  });

  it("baseUrl を差し替えられる", async () => {
    const baseUrl = "http://portal.test/portal/";
    s = await openFake(browser, { baseUrl });
    const r = await listDocuments(s.page, "absence", { baseUrl });
    expect(r[0]!.items[0]!.url).toBe(`${baseUrl}whole/gakubu/absence_form.pdf`);
  });

  it("不正な種類は VALIDATION（details に選べる種類）", async () => {
    s = await openFake(browser);
    const err = await catchError(listDocuments(s.page, "news" as never));
    expect(err.code).toBe("VALIDATION");
    expect(err.details).toMatchObject({ available: ["manual", "absence", "class_guide", "handbook", "links"] });
  });

  it("期待する表が無ければ LAYOUT_CHANGED", async () => {
    s = await openFake(browser);
    const path = "whole/web_manual.html";
    await s.context.route(`${B}${path}`, (r) =>
      r.fulfill({ contentType: "text/html", body: fakeHtml(path).replaceAll("<table>", "<div>").replaceAll("</table>", "</div>") }),
    );
    const err = await catchError(listDocuments(s.page, "manual"));
    expect(err.code).toBe("LAYOUT_CHANGED");
    expect(err.details).toMatchObject({ selector: "article table tbody tr" });
  });
});
