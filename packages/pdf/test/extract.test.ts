import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  extractItems,
  extractText,
  mapPdfAssets,
  noPdfAssets,
  pageCount,
  setPdfAssets,
  type PdfAssets,
} from "../src/index.ts";
import {
  japanesePdf,
  latinPdf,
  linesPage,
  measure,
  predefinedCMapPdf,
  type SynthPage,
} from "./helpers/synth.ts";

afterEach(() => setPdfAssets(undefined));

const textOf = async (bytes: Uint8Array, page = 1) =>
  (await extractText(bytes, { from: page, to: page }))[0]?.text;

describe("pageCount", () => {
  it("ページ数を返す", async () => {
    const pdf = await latinPdf([linesPage(["one"]), linesPage(["two"]), linesPage(["three"])]);
    expect(await pageCount(pdf)).toBe(3);
  });

  it("PDF でないバイト列は reject する", async () => {
    await expect(pageCount(new TextEncoder().encode("<!doctype html>"))).rejects.toThrow();
  });
});

describe("extractText", () => {
  let three: Uint8Array;
  beforeAll(async () => {
    three = await latinPdf([
      linesPage(["Page one first line", "Page one second line"]),
      linesPage(["Page two"]),
      linesPage(["Page three"]),
    ]);
  });

  it("全ページを 1 始まりのページ番号付きで返し、行を改行で区切る", async () => {
    const pages = await extractText(three);
    expect(pages).toEqual([
      { page: 1, text: "Page one first line\nPage one second line" },
      { page: 2, text: "Page two" },
      { page: 3, text: "Page three" },
    ]);
  });

  it("from / to でページを絞る", async () => {
    expect((await extractText(three, { from: 2, to: 3 })).map((p) => p.page)).toEqual([2, 3]);
    expect((await extractText(three, { from: 2 })).map((p) => p.page)).toEqual([2, 3]);
    expect((await extractText(three, { to: 1 })).map((p) => p.page)).toEqual([1]);
  });

  it("範囲は PDF のページ数に切り詰める", async () => {
    expect((await extractText(three, { from: 0, to: 99 })).map((p) => p.page)).toEqual([1, 2, 3]);
    expect(await extractText(three, { from: 4 })).toEqual([]);
    expect(await extractText(three, { from: 3, to: 2 })).toEqual([]);
  });

  it("同じバイト列を何度渡しても壊れない（呼び出し側の配列を切り離さない）", async () => {
    const before = three.byteLength;
    await extractText(three);
    await pageCount(three);
    expect(three.byteLength).toBe(before);
    expect((await extractText(three, { to: 1 }))[0]?.page).toBe(1);
  });

  it("上から下へ、描いた順に行を並べる", async () => {
    const pdf = await latinPdf([linesPage(["alpha", "beta", "gamma", "delta"])]);
    expect(await textOf(pdf)).toBe("alpha\nbeta\ngamma\ndelta");
  });

  it("同じ行の item は x 順に並べ、離れていれば空白を入れ、接していれば詰める", async () => {
    const w = await measure("latin");
    const page: SynthPage = {
      texts: [
        // 右側を先に描く（content stream の順と x 順が逆）
        { text: "Value", x: 300, y: 700 },
        { text: "Name", x: 72, y: 700 },
        { text: "foo", x: 72, y: 650 },
        { text: "bar", x: 72 + w("foo", 12), y: 650 },
      ],
    };
    expect(await textOf(await latinPdf([page]))).toBe("Name Value\nfoobar");
  });

  it("ベースラインがわずかにずれた item も同じ行にまとめる", async () => {
    const page: SynthPage = {
      texts: [
        { text: "left", x: 72, y: 700 },
        { text: "right", x: 200, y: 701.5 },
        { text: "next", x: 72, y: 680 },
      ],
    };
    expect(await textOf(await latinPdf([page]))).toBe("left right\nnext");
  });

  it("文字の無いページは空文字列", async () => {
    const pdf = await latinPdf([{ texts: [] }, linesPage(["x"])]);
    expect(await extractText(pdf)).toEqual([
      { page: 1, text: "" },
      { page: 2, text: "x" },
    ]);
  });

  describe("日本語（埋め込みフォント）", () => {
    it("日本語の本文を複数ページにわたって取り出す", async () => {
      const pdf = await japanesePdf([
        linesPage(["学生生活の手引き", "第1章　履修登録について"]),
        linesPage(["奨学金の申請手続き", "窓口：学生支援課（2号館）"]),
      ]);
      expect(await extractText(pdf)).toEqual([
        // 全角空白（U+3000）は pdfjs が空白の item（" "）として返すため半角になる
        { page: 1, text: "学生生活の手引き\n第1章 履修登録について" },
        { page: 2, text: "奨学金の申請手続き\n窓口：学生支援課（2号館）" },
      ]);
    });

    it("接して並ぶ日本語の item の間には空白を入れない", async () => {
      const w = await measure("japanese");
      const page: SynthPage = {
        texts: [
          { text: "便覧", x: 72 + w("学生", 12), y: 700 },
          { text: "学生", x: 72, y: 700 },
        ],
      };
      expect(await textOf(await japanesePdf([page]))).toBe("学生便覧");
    });

    it("表のような配置を行ごと・列順に復元する", async () => {
      const cols = [72, 200, 320];
      const rows = [
        ["科目名", "単位", "開講"],
        ["線形代数学", "2", "前期"],
        ["プログラミング演習", "1", "後期"],
      ];
      // 各行のセルを右の列から描き、行も下から描く（描画順に依存しないことを確かめる）
      const texts = rows
        .map((cells, r) => cells.map((text, c) => ({ text, x: cols[c]!, y: 700 - r * 24, size: 10 })).reverse())
        .reverse()
        .flat();
      const text = await textOf(await japanesePdf([{ texts }]));
      const lines = text!.split("\n");
      // 行の中は x 順
      expect(lines).toEqual(expect.arrayContaining(["科目名 単位 開講", "線形代数学 2 前期", "プログラミング演習 1 後期"]));
      expect(lines).toHaveLength(3);
    });
  });
});

describe("extractItems", () => {
  it("item の座標をページ上端基準（ベースライン）で返す", async () => {
    const w = await measure("latin");
    const pdf = await latinPdf([
      { width: 600, height: 800, texts: [{ text: "ABC", x: 100, y: 700, size: 20 }] },
      { width: 400, height: 300, texts: [{ text: "second", x: 10, y: 20 }] },
    ]);
    const p1 = await extractItems(pdf, 1);
    expect(p1.page).toBe(1);
    expect(p1.width).toBe(600);
    expect(p1.height).toBe(800);
    expect(p1.items).toHaveLength(1);
    const it0 = p1.items[0]!;
    expect(it0.str).toBe("ABC");
    expect(it0.x).toBeCloseTo(100, 3);
    expect(it0.y).toBeCloseTo(100, 3);
    expect(it0.width).toBeCloseTo(w("ABC", 20), 1);
    expect(it0.height).toBeCloseTo(20, 1);

    const p2 = await extractItems(pdf, 2);
    expect(p2).toMatchObject({ page: 2, width: 400, height: 300 });
    expect(p2.items[0]).toMatchObject({ str: "second" });
    expect(p2.items[0]!.y).toBeCloseTo(280, 3);
  });

  it("空文字列の item は含めない", async () => {
    const pdf = await japanesePdf([linesPage(["一行目", "二行目"])]);
    const { items } = await extractItems(pdf, 1);
    expect(items.length).toBeGreaterThan(0);
    for (const it of items) expect(it.str).not.toBe("");
    expect(items.map((i) => i.str).join("")).toBe("一行目二行目");
  });

  it("範囲外のページは RangeError", async () => {
    const pdf = await latinPdf([linesPage(["x"])]);
    await expect(extractItems(pdf, 0)).rejects.toBeInstanceOf(RangeError);
    await expect(extractItems(pdf, 2)).rejects.toBeInstanceOf(RangeError);
  });
});

describe("定義済み CMap（非埋め込み CJK フォント）", () => {
  const LINES = ["学生便覧の概要", "履修と成績評価"];
  let pdf: Uint8Array;
  beforeAll(async () => {
    pdf = await predefinedCMapPdf(LINES);
  });

  it("既定の資産（pdfjs-dist 同梱の CMap）で本文を復元できる", async () => {
    expect(await textOf(pdf)).toBe(LINES.join("\n"));
  });

  it("CMap が無いと本文を復元できない（CMap を渡す意味の確認）", async () => {
    setPdfAssets(noPdfAssets);
    expect(await textOf(pdf)).not.toBe(LINES.join("\n"));
  });

  it("CMap をバイト列で渡す資産でも復元でき、要求されたファイル名がわかる", async () => {
    // 単一バイナリでは CMap をファイル URL ではなく埋め込み資産から渡す。その経路の確認
    const { readFile } = await import("node:fs/promises");
    const { createRequire } = await import("node:module");
    const dir = createRequire(import.meta.url).resolve("pdfjs-dist/package.json").replace(/package\.json$/, "cmaps/");
    const requested: string[] = [];
    const cMaps: Record<string, Uint8Array> = {};
    for (const name of ["UniJIS-UCS2-H.bcmap", "Adobe-Japan1-UCS2.bcmap"]) {
      cMaps[name] = new Uint8Array(await readFile(dir + name));
    }
    const inner = mapPdfAssets({ cMaps });
    const spy: PdfAssets = {
      cMap: (name) => {
        requested.push(name);
        return inner.cMap(name);
      },
      standardFont: (name) => inner.standardFont(name),
    };
    setPdfAssets(spy);
    expect(await textOf(pdf)).toBe(LINES.join("\n"));
    expect(requested).toContain("UniJIS-UCS2-H.bcmap");
  });
});
