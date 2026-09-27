import { PdfFetchError } from "@chibatech-src/pdf";
import { PortalError } from "@chibatech-src/portal";
import { describe, expect, it } from "vitest";
import { NOTICE, Responder, clarify, ok } from "../src/respond.ts";

const json = (r: { content: { type: string; text: string }[] }) => JSON.parse(r.content.at(-1)!.text) as Record<string, unknown>;

describe("Responder", () => {
  it("最初の応答にだけ非公式の注記を付ける", () => {
    const r = new Responder();
    const first = r.success(ok({ a: 1 }, [{ title: "t", url: "https://example.test/a.pdf", pages: [2], lastModified: null }]));
    const second = r.success(ok({ a: 2 }, []));
    expect(first.content[0]!.text).toBe(NOTICE);
    expect(NOTICE).toMatch(/非公式/);
    expect(NOTICE).toMatch(/公式情報ではありません/);
    expect(NOTICE).toMatch(/原本/);
    expect(second.content).toHaveLength(1);
    expect(json(first)).toEqual({
      status: "ok",
      a: 1,
      sources: [{ title: "t", url: "https://example.test/a.pdf", pages: [2], lastModified: null }],
    });
  });

  it("エラーが最初でも注記を付け、code と details を読める形で返す", () => {
    const r = new Responder();
    const res = r.failure(new PortalError("VALIDATION", "入学年度 1999 は選べません", { available: [2026, 2025] }));
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toBe(NOTICE);
    expect(json(res)).toMatchObject({
      status: "error",
      error: { code: "VALIDATION", message: "入学年度 1999 は選べません", details: { available: [2026, 2025] } },
    });
  });

  it("LAYOUT_CHANGED は推測で補わない旨を添える", () => {
    const r = new Responder();
    const res = json(r.failure(new PortalError("LAYOUT_CHANGED", "期待する要素が見つかりません: #slt_year", { selector: "#slt_year" })));
    expect(res.error).toMatchObject({ code: "LAYOUT_CHANGED", details: { selector: "#slt_year" } });
    expect(String(res.hint)).toMatch(/構造が変わった/);
    expect(String(res.hint)).toMatch(/推測/);
  });

  it("PDF の取得失敗は FETCH として URL と HTTP 状態を返す", () => {
    const res = json(new Responder().failure(new PdfFetchError("HTTP 404 for x", "https://example.test/x.pdf", 404)));
    expect(res.error).toEqual({
      code: "FETCH",
      message: "HTTP 404 for x",
      details: { url: "https://example.test/x.pdf", status: 404 },
    });
  });

  it("想定外の例外は INTERNAL にする", () => {
    const res = json(new Responder().failure(new Error("boom")));
    expect(res.error).toEqual({ code: "INTERNAL", message: "boom" });
  });

  it("聞き返しは needs_clarification として候補を返す（エラーではない）", () => {
    const r = new Responder();
    r.success(ok({}, []));
    const res = r.success(clarify("どの学科ですか", [{ code: "X1", name: "架空工学科" }], []));
    expect(res.isError).toBeUndefined();
    expect(json(res)).toEqual({
      status: "needs_clarification",
      question: "どの学科ですか",
      candidates: [{ code: "X1", name: "架空工学科" }],
      sources: [],
    });
  });
});
