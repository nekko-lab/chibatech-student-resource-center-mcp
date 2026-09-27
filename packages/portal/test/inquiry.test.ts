import type { Browser } from "playwright-core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_BASE_URL, listContacts, listFaq, snapshot } from "../src/index.ts";
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

describe("listFaq", () => {
  it("分類・質問・回答を返す（Q/A の印は除き、閉じた dd も読む）", async () => {
    s = await openFake(browser);
    const faq = await listFaq(s.page);
    expect(s.page.url()).toBe(`${B}whole/inquiry.html`);
    expect(faq).toHaveLength(4);
    expect(faq.map((f) => f.category)).toEqual([
      "架空の学生番号について",
      "架空の欠席について",
      "架空の欠席について",
      "架空のアルバイトについて",
    ]);
    expect(faq[1]).toEqual({
      category: "架空の欠席について",
      q: "架空の欠席連絡はどこに出しますか。",
      a: "架空センターの窓口に提出してください。",
    });
    // 入れ子の要素（ol・h4・p・br）は改行で区切る
    expect(faq[0]!.a).toBe(
      [
        "架空の学生番号は年度・学科・個人番号の順に並びます。",
        "(a) は年度です。",
        "(b) は学科です。",
        "＜架空の学科一覧＞",
        "X1：架空工学科",
        "Y2：模擬情報学科",
      ].join("\n"),
    );
    // 表は行ごとに改行、セルはタブ区切り
    expect(faq[3]!.a).toBe(["あります。", "担当\t種類", "架空係\t受付補助", "模擬係\t資料整理"].join("\n"));
    expect(faq[2]!.a).toBe("必要に応じて受診記録票を添えてください。");
  });

  it("dl.faq が無ければ LAYOUT_CHANGED", async () => {
    s = await openFake(browser);
    const path = "whole/inquiry.html";
    await s.context.route(`${B}${path}`, (r) =>
      r.fulfill({ contentType: "text/html", body: fakeHtml(path).replaceAll('class="faq"', 'class="qa"') }),
    );
    const err = await catchError(listFaq(s.page));
    expect(err.code).toBe("LAYOUT_CHANGED");
    expect(err.details).toMatchObject({ selector: "article dl.faq" });
  });
});

describe("listContacts", () => {
  it("窓口（分類・名称・キャンパス・電話・取扱時間・全文）を返す", async () => {
    s = await openFake(browser);
    const c = await listContacts(s.page);
    expect(c).toHaveLength(6);
    expect(c[0]).toEqual({
      group: "総合窓口（架空）",
      name: "北キャンパス",
      campus: "北キャンパス",
      hours: "取扱時間（月～金）9：00～17：00 （土曜日）9：00～12：00",
      raw: "北キャンパス\n架空1号館1階\n取扱時間（月～金）9：00～17：00\n（土曜日）9：00～12：00",
    });
    expect(c[2]).toEqual({
      group: "部署別連絡先（架空）",
      name: "架空センター　教務係",
      campus: "北キャンパス",
      phone: "000-0000-0001",
      hours: "取扱時間（月～金）9：00～17：00 （土曜日）9：00～12：00",
      raw: [
        "架空センター　教務係",
        "北キャンパス",
        "架空1号館1階",
        "000-0000-0001",
        "取扱時間（月～金）9：00～17：00",
        "（土曜日）9：00～12：00",
        "主な取扱事項",
        "架空の履修・成績",
      ].join("\n"),
    });
    // 複数キャンパスにまたがる窓口は campus を決めない
    expect(c[4]).toMatchObject({ group: "部署別連絡先（架空）", name: "架空保健室" });
    expect(c[4]).not.toHaveProperty("campus");
    expect(c[4]).not.toHaveProperty("phone");
    // 構造化できない窓口は raw だけ
    expect(c[5]).toEqual({
      group: "部署別連絡先（架空）",
      name: "架空サービス株式会社",
      raw: "架空サービス株式会社\n架空の推奨機器の問い合わせ先",
    });
  });

  it(".inquiry-box が無ければ LAYOUT_CHANGED", async () => {
    s = await openFake(browser);
    const path = "whole/inquiry.html";
    await s.context.route(`${B}${path}`, (r) =>
      r.fulfill({ contentType: "text/html", body: fakeHtml(path).replaceAll("inquiry-box", "contact-box") }),
    );
    const err = await catchError(listContacts(s.page));
    expect(err.code).toBe("LAYOUT_CHANGED");
    expect(err.details).toMatchObject({ selector: "article .inquiry-box" });
  });
});

describe("snapshot", () => {
  it("body の ARIA スナップショット（YAML 風の文字列）を返す", async () => {
    s = await openFake(browser);
    await s.page.goto(`${B}whole/link.html`);
    const snap = await snapshot(s.page);
    expect(typeof snap).toBe("string");
    expect(snap).toContain('heading "関連サイト"');
    expect(snap).toContain('link "架空ポータル"');
  });
});
