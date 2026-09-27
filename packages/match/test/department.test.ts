import { describe, expect, it } from "vitest";
import { parseDeptOption, resolveDepartment, type DeptOption } from "../src/index";

// テスト用の選択肢。学科名は事実だが、課題文に例示の無いコード（X?/Y?/Z?）は架空の値。
const RAW_UNDERGRAD = [
  "A1：機械工学科",
  "X2：機械電子創成工学科",
  "X3：先端材料工学科",
  "X4：電気電子工学科",
  "X5：情報通信システム工学科",
  "X6：応用化学科",
  "Y1：建築学科",
  "Y2：都市環境工学科",
  "Y3：デザイン科学科",
  "Y4：知能メディア工学科",
  "Y5：未来ロボティクス学科",
  "G1：情報工学科（2024年度入学～）",
  "31：情報工学科（～2023年度入学）",
  "Z1：認知情報科学科",
  "Z2：経営情報科学科",
  "Z3：プロジェクトマネジメント学科",
];
const RAW_GRADUATE = [
  "P1：機械工学専攻",
  "81：情報科学専攻（修士課程）",
  "89：情報科学専攻（博士後期課程）",
];

const undergrad: DeptOption[] = RAW_UNDERGRAD.map(parseDeptOption);
const graduate: DeptOption[] = RAW_GRADUATE.map(parseDeptOption);
const all: DeptOption[] = [...undergrad, ...graduate];

const codesOf = (cands: { item: DeptOption }[]) => cands.map((c) => c.item.code);

describe("parseDeptOption", () => {
  it("「コード：名称」を分解する", () => {
    expect(parseDeptOption("G1：情報工学科（2024年度入学～）")).toEqual({
      code: "G1",
      name: "情報工学科（2024年度入学～）",
    });
    expect(parseDeptOption("31：情報工学科（～2023年度入学）")).toEqual({
      code: "31",
      name: "情報工学科（～2023年度入学）",
    });
  });

  it("半角コロン・全角コード・前後の空白を受ける", () => {
    expect(parseDeptOption(" A1:機械工学科 ")).toEqual({ code: "A1", name: "機械工学科" });
    expect(parseDeptOption("Ｐ１：機械工学専攻")).toEqual({ code: "P1", name: "機械工学専攻" });
  });

  it("コードが無ければ名称だけを返す", () => {
    expect(parseDeptOption("機械工学科")).toEqual({ code: "", name: "機械工学科" });
  });
});

describe("resolveDepartment", () => {
  it.each(["G1", "g1", "Ｇ１", " G1 "])("コード入力 %s を解決する", (q) => {
    const r = resolveDepartment(q, all);
    expect(r.best?.code).toBe("G1");
    expect(r.ambiguous).toBe(false);
    expect(r.candidates[0]?.score).toBe(1);
  });

  it("名称の部分一致「情報工学」は情報工学科を情報通信システム工学科より上に置く", () => {
    const r = resolveDepartment("情報工学", undergrad);
    const codes = codesOf(r.candidates);
    const idxInfoG1 = codes.indexOf("G1");
    const idx31 = codes.indexOf("31");
    const idxTsushin = codes.indexOf("X5");
    expect(idxInfoG1).toBeGreaterThanOrEqual(0);
    expect(idx31).toBeGreaterThanOrEqual(0);
    expect(Math.max(idxInfoG1, idx31)).toBeLessThan(idxTsushin === -1 ? Infinity : idxTsushin);
  });

  it("年度注記は弱く扱うので、同名で年度違いのコードは聞き返し（ambiguous）になる", () => {
    const r = resolveDepartment("情報工学科", undergrad);
    expect(codesOf(r.candidates).slice(0, 2).sort()).toEqual(["31", "G1"]);
    expect(r.ambiguous).toBe(true);
    expect(r.best).toBeUndefined();
  });

  it("略称「情工」を辞書で解決する（年度が無ければ聞き返し）", () => {
    const r = resolveDepartment("情工", undergrad);
    expect(codesOf(r.candidates).slice(0, 2).sort()).toEqual(["31", "G1"]);
    expect(r.ambiguous).toBe(true);
  });

  it("問い合わせに入学年度があれば年度注記で絞る", () => {
    expect(resolveDepartment("2024年入学の情工", undergrad).best?.code).toBe("G1");
    expect(resolveDepartment("2026年度入学 情報工学科", undergrad).best?.code).toBe("G1");
    expect(resolveDepartment("2023年度入学の情報工学科", undergrad).best?.code).toBe("31");
    expect(resolveDepartment("情工 2019", undergrad).best?.code).toBe("31");
  });

  it.each([
    ["機械", "A1"],
    ["建築", "Y1"],
    ["PM", "Z3"],
    ["ｐｍ", "Z3"],
    ["プロマネ", "Z3"],
    ["機電", "X2"],
    ["応化", "X6"],
    ["情通", "X5"],
    ["ロボ", "Y5"],
    ["機械電子", "X2"],
  ])("略称・短縮形 %s → %s", (q, code) => {
    const r = resolveDepartment(q, undergrad);
    expect(r.best?.code).toBe(code);
    expect(r.ambiguous).toBe(false);
  });

  it("「機械」は機械工学科を機械電子創成工学科より上に置く", () => {
    const codes = codesOf(resolveDepartment("機械", undergrad).candidates);
    expect(codes[0]).toBe("A1");
  });

  it("括弧内の課程注記（修士・博士）で専攻を区別する", () => {
    expect(resolveDepartment("情報科学専攻 修士", graduate).best?.code).toBe("81");
    expect(resolveDepartment("情報科学専攻の博士課程", graduate).best?.code).toBe("89");
    const r = resolveDepartment("情報科学専攻", graduate);
    expect(r.ambiguous).toBe(true);
    expect(codesOf(r.candidates).slice(0, 2).sort()).toEqual(["81", "89"]);
  });

  it("文中に学科名が含まれていても当てる", () => {
    expect(resolveDepartment("建築学科の卒業要件", undergrad).best?.code).toBe("Y1");
  });

  it("name に「コード：名称」の生文字列を入れた選択肢も受ける", () => {
    const raw: DeptOption[] = RAW_UNDERGRAD.map((s) => ({ code: "", name: s }));
    expect(resolveDepartment("g1", raw).best?.code).toBe("G1");
    expect(resolveDepartment("建築", raw).best?.name).toBe("Y1：建築学科");
  });

  it("当てはまらなければ候補なし", () => {
    const r = resolveDepartment("料理", undergrad);
    expect(r.candidates).toEqual([]);
    expect(r.best).toBeUndefined();
    expect(r.ambiguous).toBe(false);
    expect(resolveDepartment("", undergrad).candidates).toEqual([]);
    expect(resolveDepartment("情工", []).candidates).toEqual([]);
  });

  it("score は 0〜1 の降順で reason を持つ", () => {
    for (const q of ["情報", "工学", "情工", "G1", "機械"]) {
      const { candidates } = resolveDepartment(q, all);
      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i]!;
        expect(c.score).toBeGreaterThan(0);
        expect(c.score).toBeLessThanOrEqual(1);
        expect(c.reason.length).toBeGreaterThan(0);
        if (i > 0) expect(c.score).toBeLessThanOrEqual(candidates[i - 1]!.score);
      }
    }
  });

  it("選択肢 50 件で 1 回の照合が 10ms を超えない", () => {
    const many = [...all, ...all, ...all].slice(0, 50);
    const queries = ["情工", "2024年入学の情報工学科", "機械電子", "G1", "ぷろじぇくと"];
    const runs = 200;
    const t0 = Date.now();
    for (let i = 0; i < runs; i++) resolveDepartment(queries[i % queries.length]!, many);
    const perCall = (Date.now() - t0) / runs;
    expect(perCall).toBeLessThan(10);
  });
});
