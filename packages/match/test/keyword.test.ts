import { describe, expect, it } from "vitest";
import { searchByKeyword } from "../src/index";

// テスト用の資料タイトル（架空）。
const TITLES = [
  "奨学制度について",
  "授業料・学生納付金の納入",
  "欠席届の提出方法",
  "学内無線LAN（Wi-Fi）の利用",
  "学生証の再発行",
  "スクールバス時刻表（バスダイヤ）",
  "クラス担任制度",
  "進級資格要件一覧",
  "卒業要件と単位",
  "履修登録の手引き",
  "定期試験の注意事項",
];

const id = (s: string) => s;
const top = (q: string, items: string[] = TITLES) => searchByKeyword(q, items, id)[0]?.item;

describe("searchByKeyword", () => {
  it("そのままの語で当てる", () => {
    expect(top("履修")).toBe("履修登録の手引き");
    expect(top("定期試験")).toBe("定期試験の注意事項");
  });

  it.each([
    ["奨学金", "奨学制度について"],
    ["学費", "授業料・学生納付金の納入"],
    ["授業料", "授業料・学生納付金の納入"],
    ["休む", "欠席届の提出方法"],
    ["欠席", "欠席届の提出方法"],
    ["wifi", "学内無線LAN（Wi-Fi）の利用"],
    ["ＷＩ－ＦＩ", "学内無線LAN（Wi-Fi）の利用"],
    ["ネットワーク", "学内無線LAN（Wi-Fi）の利用"],
    ["無線", "学内無線LAN（Wi-Fi）の利用"],
    ["学生番号", "学生証の再発行"],
    ["バス", "スクールバス時刻表（バスダイヤ）"],
    ["担任", "クラス担任制度"],
    ["進級", "進級資格要件一覧"],
    ["進級要件", "進級資格要件一覧"],
    ["卒業", "卒業要件と単位"],
  ])("同義語で展開する: %s → %s", (q, expected) => {
    expect(top(q)).toBe(expected);
  });

  it("「〜について」などの言い回しを落として当てる", () => {
    expect(top("奨学金について")).toBe("奨学制度について");
    expect(top("学費を教えて")).toBe("授業料・学生納付金の納入");
  });

  it("空白区切りの複数語は AND", () => {
    const r = searchByKeyword("履修 手引き", TITLES, id);
    expect(r.map((c) => c.item)).toEqual(["履修登録の手引き"]);
    expect(searchByKeyword("履修 奨学金", TITLES, id)).toEqual([]);
    expect(searchByKeyword("卒業　単位", TITLES, id).map((c) => c.item)).toEqual(["卒業要件と単位"]);
  });

  it("利用者の語そのものの一致は同義語の一致より上に来る", () => {
    const items = ["奨学制度について", "奨学金の返還"];
    const r = searchByKeyword("奨学金", items, id);
    expect(r.map((c) => c.item)).toEqual(["奨学金の返還", "奨学制度について"]);
    expect(r[0]!.score).toBeGreaterThan(r[1]!.score);
  });

  it("カタカナ・全角の揺れを吸収する", () => {
    expect(top("すくーるばす")).toBe("スクールバス時刻表（バスダイヤ）");
    expect(top("ｸﾗｽ")).toBe("クラス担任制度");
  });

  it("getText で任意の要素型を扱う", () => {
    const docs = TITLES.map((title, i) => ({ id: i, title }));
    const r = searchByKeyword("奨学金", docs, (d) => d.title);
    expect(r[0]?.item).toEqual({ id: 0, title: "奨学制度について" });
  });

  it("limit と minScore を守る", () => {
    const items = ["奨学金A", "奨学金B", "奨学金C", "奨学制度"];
    expect(searchByKeyword("奨学金", items, id, { limit: 2 })).toHaveLength(2);
    const strict = searchByKeyword("奨学金", items, id, { minScore: 0.8 });
    expect(strict.map((c) => c.item)).not.toContain("奨学制度");
  });

  it("score は 0〜1 の降順で reason を持つ", () => {
    const r = searchByKeyword("要件", TITLES, id);
    expect(r.length).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < r.length; i++) {
      expect(r[i]!.score).toBeGreaterThan(0);
      expect(r[i]!.score).toBeLessThanOrEqual(1);
      expect(r[i]!.reason.length).toBeGreaterThan(0);
      if (i > 0) expect(r[i]!.score).toBeLessThanOrEqual(r[i - 1]!.score);
    }
  });

  it("空の問い合わせ・該当なしは空配列", () => {
    expect(searchByKeyword("", TITLES, id)).toEqual([]);
    expect(searchByKeyword("   ", TITLES, id)).toEqual([]);
    expect(searchByKeyword("量子力学", TITLES, id)).toEqual([]);
  });

  it("資料 500 件で 1 回の照合が 10ms を超えない", () => {
    const many = Array.from({ length: 500 }, (_, i) => `${TITLES[i % TITLES.length]}（第${i}版）`);
    const queries = ["奨学金", "学費 納入", "wifi", "進級要件", "休む"];
    const runs = 50;
    const t0 = Date.now();
    for (let i = 0; i < runs; i++) searchByKeyword(queries[i % queries.length]!, many, id);
    const perCall = (Date.now() - t0) / runs;
    expect(perCall).toBeLessThan(10);
  });
});
