import { describe, expect, it } from "vitest";
import { findTeachers, parseClassTeachers, type TeacherTable } from "../src/index.ts";
import { makeTeacherPages, sampleTeacherFixture, type TeacherFixture } from "./fixtures/teacher-generator.ts";

/** 生成器の入力から期待される rows を組み立てる */
function expectedRows(fx: TeacherFixture): TeacherTable["rows"] {
  const rows: TeacherTable["rows"] = [];
  for (const blocks of fx.pages) {
    for (const b of blocks) {
      for (const d of b.departments) {
        rows.push({
          faculty: b.faculty,
          department: d.name,
          ...(d.head ? { head: d.head } : {}),
          years: ([1, 2, 3, 4] as const).map((year) => ({
            year,
            teachers: (d.years[year - 1] ?? []).map((t) => ({ name: t.name, main: t.main ?? false })),
          })),
        });
      }
    }
  }
  for (const s of fx.graduate?.schools ?? []) {
    for (const m of s.majors) rows.push({ faculty: s.name, department: m.name, head: m.head, years: [] });
  }
  return rows;
}

describe("parseClassTeachers", () => {
  const fx = sampleTeacherFixture();
  const table = parseClassTeachers(makeTeacherPages(fx));

  it("見出しと凡例を読む", () => {
    expect(table.title).toBe("2099年度 学科長・クラス担任表");
    expect(table.legend).toBe("◎：主担任（架空学部のみ）");
  });

  it("学部ブロックごとに繰り返される見出し行を境に、縦書きの学部名と複数行にまたがる学科を復元する", () => {
    expect(table.rows.map((r) => [r.faculty, r.department])).toEqual(expectedRows(fx).map((r) => [r.faculty, r.department]));
  });

  it("各年次の複数名・主担任 ◎・姓名の空白・5 文字の氏名を復元する", () => {
    expect(table.rows).toEqual(expectedRows(fx));
    const mech = table.rows[0]!;
    expect(mech.years[0]!.teachers).toEqual([
      { name: "乙川 二郎", main: true },
      { name: "丙田 三子", main: false },
    ]);
  });

  it("空欄の年次は空配列で返す", () => {
    const space = table.rows.find((r) => r.department === "宇宙資源工学科")!;
    expect(space.years.map((y) => y.teachers.length)).toEqual([2, 1, 0, 0]);
  });

  it("2 ページ目の専攻長一覧は 研究科→faculty・専攻→department・専攻長→head（職名を除く）で返す", () => {
    const grad = table.rows.filter((r) => r.years.length === 0);
    expect(grad.map((r) => [r.faculty, r.department, r.head])).toEqual([
      ["架空工学研究科", "機構工学専攻", "甲野 一郎"],
      ["架空工学研究科", "宇宙資源工学専攻", "子安 一葉"],
      ["架空工学研究科", "架空工学専攻", "卯月 四葉"],
      ["仮想科学研究科", "仮想科学専攻", "亥野 十"],
    ]);
  });

  it("列の位置が変わっても同じ結果になる（固定の座標に依存しない）", () => {
    const moved = sampleTeacherFixture({
      geometry: { facultyX: 60, deptX: 140, headX: 240, yearX: [305, 370, 435, 500], firstHeaderY: 80 },
    });
    expect(parseClassTeachers(makeTeacherPages(moved)).rows).toEqual(expectedRows(moved));
  });

  it("見出し行のないページは例外にせず notes に残す", () => {
    const t = parseClassTeachers([{ page: 1, width: 100, height: 100, items: [{ str: "無関係", x: 1, y: 1, width: 10, height: 10 }] }]);
    expect(t.rows).toEqual([]);
    expect(t.notes?.some((n) => n.includes("読み取れなかった"))).toBe(true);
    expect(parseClassTeachers([]).rows).toEqual([]);
  });
});

describe("findTeachers", () => {
  const table = parseClassTeachers(makeTeacherPages(sampleTeacherFixture()));

  it("学科名が完全一致する行があればそれだけを返す", () => {
    const rows = findTeachers(table, { department: "情報工学科" });
    expect(rows.map((r) => r.department)).toEqual(["情報工学科"]);
  });

  it("year を指定するとその年次だけに絞る", () => {
    const [row] = findTeachers(table, { department: "機構工学科", year: 2 });
    expect(row!.years).toEqual([
      {
        year: 2,
        teachers: [
          { name: "丁原 四季", main: true },
          { name: "戊井 五月", main: false },
        ],
      },
    ]);
  });

  it("完全一致がなければ部分一致（空白・全角半角の違いは無視）", () => {
    expect(findTeachers(table, { department: "宇宙資源" }).map((r) => r.department)).toEqual(["宇宙資源工学科", "宇宙資源工学専攻"]);
    expect(findTeachers(table, { department: "機構 工学" }).map((r) => r.department)).toEqual(["機構工学科", "機構工学専攻"]);
  });

  it("year 指定時、その年次の列を持たない行（専攻長一覧）は除く", () => {
    expect(findTeachers(table, { department: "機構工学", year: 1 }).map((r) => r.department)).toEqual(["機構工学科"]);
  });

  it("見つからなければ空配列", () => {
    expect(findTeachers(table, { department: "存在しない学科" })).toEqual([]);
  });
});
