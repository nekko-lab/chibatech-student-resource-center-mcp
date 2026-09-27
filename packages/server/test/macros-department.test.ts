import { describe, expect, it } from "vitest";
import { findDepartmentPage, lookupHandbookTopic, lookupRequirements } from "../src/macros/department.ts";
import type { Outcome } from "../src/respond.ts";
import { BASE, LM, fakeEnv } from "./helpers/ports.ts";

function okData(o: Outcome): Record<string, unknown> {
  if (o.status !== "ok") throw new Error(`ok ではない: ${JSON.stringify(o)}`);
  return o.data;
}

const LIFE = `${BASE}fic/common_2099/life.pdf`;
const XENG = `${BASE}fic/xeng_2099.pdf`;

describe("findDepartmentPage", () => {
  it("プロフィールの区分・年度・学科で学科ページを開き、節の一覧と出典を返す", async () => {
    const { env, portal } = fakeEnv({ studentType: "undergrad", admissionYear: 2099, department: "X1" });
    const o = await findDepartmentPage(env, {});
    const d = okData(o);
    expect(d.department).toEqual({ code: "X1", name: "架空機械学科" });
    expect(d.studentType).toBe("undergrad");
    expect(d.admissionYear).toBe(2099);
    const sections = d.sections as { title: string; items: { title: string; page?: number }[] }[];
    expect(sections.map((s) => s.title)).toEqual(["架空の生活案内", "架空の要件と課程表", "架空の外部案内"]);
    expect(sections[0]!.items[2]).toMatchObject({ title: "架空のクラス担任", page: 13, pdfUrl: LIFE });
    expect(o.sources).toEqual([{ title: "2099年度入学 架空学部 架空機械学科", url: `${BASE}fic/x1_2099.html`, lastModified: LM }]);
    expect(portal.calls).toEqual(["departments undergrad 2099", "departmentPage undergrad 2099 X1"]);
  });

  it("引数がプロフィールより優先し、学科名・略した名前・相対的な年でもよい", async () => {
    const { env, portal } = fakeEnv({ studentType: "graduate", admissionYear: 2050, department: "Q1" });
    const d = okData(await findDepartmentPage(env, { studentType: "学部生", year: "去年", department: "模擬情報デザイン" }));
    expect(d.department).toEqual({ code: "Y3", name: "模擬情報デザイン学科" });
    expect(portal.calls[0]).toBe("departments undergrad 2098");
  });

  it("学科が曖昧なら候補を返して聞き返す（検索はしない）", async () => {
    const { env, portal } = fakeEnv({ studentType: "graduate", admissionYear: 2099 });
    const o = await findDepartmentPage(env, { department: "架空工学専攻" });
    expect(o.status).toBe("needs_clarification");
    if (o.status !== "needs_clarification") return;
    expect(o.question).toMatch(/架空工学専攻/);
    expect((o.candidates as { code: string }[]).map((c) => c.code).sort()).toEqual(["Q1", "Q9"]);
    expect(portal.calls.some((c) => c.startsWith("departmentPage"))).toBe(false);
  });

  it("区分が分からなければ聞き返す", async () => {
    const { env } = fakeEnv();
    const o = await findDepartmentPage(env, { year: 2099, department: "X1" });
    expect(o.status).toBe("needs_clarification");
    if (o.status !== "needs_clarification") return;
    expect(o.candidates).toEqual([
      { value: "undergrad", label: "学部生" },
      { value: "graduate", label: "大学院生" },
    ]);
  });

  it("年度が無ければ選べる年度を返して聞き返す", async () => {
    const { env } = fakeEnv({ studentType: "undergrad" });
    const o = await findDepartmentPage(env, { department: "X1" });
    expect(o.status).toBe("needs_clarification");
    if (o.status !== "needs_clarification") return;
    expect(o.candidates).toEqual([2099, 2098]);
  });

  it("選べない年度なら選べる年度を返して聞き返す", async () => {
    const { env } = fakeEnv({ studentType: "undergrad" });
    const o = await findDepartmentPage(env, { year: 1999, department: "X1" });
    expect(o.status).toBe("needs_clarification");
    if (o.status !== "needs_clarification") return;
    expect(o.question).toMatch(/1999/);
    expect(o.candidates).toEqual([2099, 2098]);
  });

  it("学科が無い・当たらないなら選択肢を返して聞き返す", async () => {
    const { env } = fakeEnv({ studentType: "undergrad", admissionYear: 2099 });
    const none = await findDepartmentPage(env, {});
    expect(none.status).toBe("needs_clarification");
    const miss = await findDepartmentPage(env, { department: "存在しない学科" });
    expect(miss.status).toBe("needs_clarification");
    if (miss.status !== "needs_clarification") return;
    expect((miss.candidates as { code: string }[]).map((c) => c.code)).toEqual(["X1", "Y2", "Y3"]);
  });
});

describe("lookupRequirements", () => {
  it("該当項目のページ範囲だけを読み、種類の語を含むページに絞る", async () => {
    const { env, docs } = fakeEnv({ studentType: "undergrad", admissionYear: 2099, department: "X1" });
    docs.texts.set(
      XENG,
      Array.from({ length: 12 }, (_, i) =>
        i + 1 === 8 ? "架空の進級要件 本文" : i + 1 === 9 ? "架空の卒業要件 本文" : `架空の教育課程表 ${i + 1}`,
      ),
    );
    const o = await lookupRequirements(env, { kind: "進級" });
    const d = okData(o);
    expect(d.item).toEqual({ title: "架空の進級・卒業要件と教育課程表", section: "架空の要件と課程表" });
    expect(d.range).toEqual({ from: 7 });
    expect((d.pages as { page: number }[]).map((p) => p.page)).toEqual([8]);
    expect(d.omittedPages).toEqual([7, 9, 10, 11, 12]);
    expect(o.sources[1]).toEqual({ title: "架空の進級・卒業要件と教育課程表", url: XENG, pages: [8], lastModified: LM });
    expect(docs.calls).toEqual([`text ${XENG} 7-`]);
  });

  it("教育課程はページを絞らない", async () => {
    const { env, docs } = fakeEnv({ studentType: "undergrad", admissionYear: 2099, department: "X1" });
    docs.texts.set(XENG, Array.from({ length: 9 }, (_, i) => `架空 ${i + 1}`));
    const d = okData(await lookupRequirements(env, { kind: "教育課程" }));
    expect((d.pages as { page: number }[]).map((p) => p.page)).toEqual([7, 8, 9]);
  });

  it("該当項目が無ければ項目の一覧を返して聞き返す", async () => {
    const { env, portal } = fakeEnv({ studentType: "undergrad", admissionYear: 2099, department: "X1" });
    portal.departmentPage = async () => ({
      url: `${BASE}fic/x1.html`,
      heading: "h",
      sections: [{ title: "架空", items: [{ title: "架空の学則", href: `${BASE}r.pdf`, pdfUrl: `${BASE}r.pdf` }] }],
      lastModified: null,
    });
    const o = await lookupRequirements(env, { kind: "卒業" });
    expect(o.status).toBe("needs_clarification");
  });
});

describe("lookupHandbookTopic", () => {
  it("話題に当たる項目のページだけを読む（同義語でも当たる）", async () => {
    const { env, docs } = fakeEnv({ studentType: "undergrad", admissionYear: 2099, department: "X1" });
    docs.texts.set(LIFE, Array.from({ length: 24 }, (_, i) => `架空の本文 p${i + 1}`));
    const o = await lookupHandbookTopic(env, { topic: "奨学金" });
    const d = okData(o);
    expect(d.item).toMatchObject({ title: "架空の奨学制度", section: "架空の生活案内" });
    expect((d.pages as { page: number }[]).map((p) => p.page)).toEqual([20, 21, 22, 23]);
    expect(d.next).toEqual({ from: 24, to: 24 });
    expect(o.sources[1]).toMatchObject({ url: LIFE, pages: [20, 21, 22, 23], lastModified: LM });
  });

  it("同じページを共有する項目は同じ範囲を読む", async () => {
    const { env, docs } = fakeEnv({ studentType: "undergrad", admissionYear: 2099, department: "X1" });
    docs.texts.set(LIFE, Array.from({ length: 24 }, (_, i) => `架空の本文 p${i + 1}`));
    const d = okData(await lookupHandbookTopic(env, { topic: "通学" }));
    expect(d.range).toEqual({ from: 13, to: 19 });
  });

  it("PDF でない項目は URL だけを返す", async () => {
    const { env, docs } = fakeEnv({ studentType: "undergrad", admissionYear: 2099, department: "X1" });
    const d = okData(await lookupHandbookTopic(env, { topic: "学習システム" }));
    expect(d.item).toMatchObject({ title: "架空の学習システム", url: "https://lms.example.com/" });
    expect(d.pages).toBeUndefined();
    expect(docs.calls).toEqual([]);
  });

  it("当たらなければ項目の一覧を返して聞き返す", async () => {
    const { env } = fakeEnv({ studentType: "undergrad", admissionYear: 2099, department: "X1" });
    const o = await lookupHandbookTopic(env, { topic: "宇宙旅行" });
    expect(o.status).toBe("needs_clarification");
    if (o.status !== "needs_clarification") return;
    expect(JSON.stringify(o.candidates)).toContain("架空の奨学制度");
  });
});
