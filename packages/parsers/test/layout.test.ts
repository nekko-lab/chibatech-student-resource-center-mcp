import { describe, expect, it } from "vitest";
import { columnBoundaries, columnOf, groupLines, groupWords, normalize, toBoxes } from "../src/layout.ts";

describe("toBoxes", () => {
  it("空文字と空白だけの item を捨て、右端と中心を持たせる", () => {
    const boxes = toBoxes([
      { str: "", x: 10, y: 5, width: 0, height: 0 },
      { str: " ", x: 12, y: 5, width: 90, height: 0 },
      { str: "平", x: 20, y: 5, width: 10, height: 10 },
    ]);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toMatchObject({ str: "平", x0: 20, x1: 30, cx: 25, y: 5, h: 10 });
  });
});

describe("groupLines / groupWords", () => {
  const items = [
    { str: "科", x: 154.3, y: 57.4, width: 6.8, height: 6.8 },
    { str: "学", x: 140.5, y: 57.4, width: 6.8, height: 6.8 },
    { str: "学部", x: 74.8, y: 57.5, width: 13.8, height: 6.8 },
    { str: "次の行", x: 74.8, y: 70.8, width: 20.4, height: 6.8 },
  ];

  it("ベースラインの近い item を 1 行にまとめ、x 順に並べる", () => {
    const lines = groupLines(toBoxes(items));
    expect(lines).toHaveLength(2);
    expect(lines[0]!.boxes.map((b) => b.str)).toEqual(["学部", "学", "科"]);
  });

  it("文字高さに比べて近い item を 1 語につなぐ", () => {
    const [line] = groupLines(toBoxes(items));
    expect(groupWords(line!, 1.5).map((w) => w.str)).toEqual(["学部", "学科"]);
  });
});

describe("columnBoundaries", () => {
  it("隣り合う見出しの間で、内容が最も広く空いている区間の中央を境界にする", () => {
    const b = columnBoundaries(
      [
        { x0: 0, x1: 10 },
        { x0: 50, x1: 60 },
      ],
      [
        { x0: 0, x1: 20 },
        { x0: 35, x1: 60 },
      ],
    );
    expect(b).toEqual([27.5]);
  });

  it("見出しの間が内容で埋まっているときは見出し間の中央を使う", () => {
    const b = columnBoundaries(
      [
        { x0: 0, x1: 10 },
        { x0: 20, x1: 30 },
      ],
      [{ x0: 5, x1: 25 }],
    );
    expect(b).toEqual([15]);
  });

  it("見出し同士が重なるときは中心の中点を使う", () => {
    const b = columnBoundaries(
      [
        { x0: 0, x1: 12 },
        { x0: 10, x1: 30 },
      ],
      [],
    );
    expect(b).toEqual([13]);
  });

  it("columnOf は境界から列番号を返す", () => {
    expect(columnOf([10, 20], 5)).toBe(0);
    expect(columnOf([10, 20], 15)).toBe(1);
    expect(columnOf([10, 20], 25)).toBe(2);
  });
});

describe("normalize", () => {
  it("NFKC で全角英数・括弧を半角にし、空白を取り除く", () => {
    expect(normalize("１２月 24日（金）")).toBe("12月24日(金)");
  });
});
