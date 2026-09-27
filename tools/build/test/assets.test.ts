import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectPdfAssets,
  renderPreamble,
  selectPdfAssets,
  summarizePdfAssets,
  type PdfAssetFile,
} from "../src/assets.ts";
import { embeddedPdfAssets } from "../src/runtime-assets.ts";

const file = (kind: PdfAssetFile["kind"], name: string, bytes: number): PdfAssetFile => ({
  kind,
  name,
  bytes,
  path: `/pdfjs/${kind === "cMap" ? "cmaps" : "standard_fonts"}/${name}`,
});

describe("selectPdfAssets", () => {
  it("cmaps は .bcmap、standard_fonts は .pfb / .ttf だけを名前順に選ぶ（LICENSE などは除く）", () => {
    const picked = selectPdfAssets({
      cMaps: [
        { name: "UniJIS-UCS2-H.bcmap", path: "/p/cmaps/UniJIS-UCS2-H.bcmap", bytes: 10 },
        { name: "LICENSE", path: "/p/cmaps/LICENSE", bytes: 1 },
        { name: "Adobe-Japan1-UCS2.bcmap", path: "/p/cmaps/Adobe-Japan1-UCS2.bcmap", bytes: 20 },
      ],
      standardFonts: [
        { name: "LICENSE_FOXIT", path: "/p/f/LICENSE_FOXIT", bytes: 1 },
        { name: "LiberationSans-Regular.ttf", path: "/p/f/LiberationSans-Regular.ttf", bytes: 30 },
        { name: "FoxitSerif.pfb", path: "/p/f/FoxitSerif.pfb", bytes: 40 },
      ],
    });
    expect(picked.map((f) => `${f.kind}:${f.name}`)).toEqual([
      "cMap:Adobe-Japan1-UCS2.bcmap",
      "cMap:UniJIS-UCS2-H.bcmap",
      "standardFont:FoxitSerif.pfb",
      "standardFont:LiberationSans-Regular.ttf",
    ]);
  });

  it("日本語に要る CMap が無ければ止める", () => {
    expect(() =>
      selectPdfAssets({
        cMaps: [{ name: "UniJIS-UCS2-H.bcmap", path: "/x", bytes: 1 }],
        standardFonts: [{ name: "FoxitSerif.pfb", path: "/y", bytes: 1 }],
      }),
    ).toThrow(/Adobe-Japan1-UCS2\.bcmap/);
  });
});

describe("summarizePdfAssets", () => {
  it("種類ごとの件数と合計サイズ、ファイルごとのサイズを記録する", () => {
    const summary = summarizePdfAssets([file("cMap", "a.bcmap", 10), file("cMap", "b.bcmap", 5), file("standardFont", "c.ttf", 7)]);
    expect(summary).toEqual({
      cMaps: { count: 2, bytes: 15 },
      standardFonts: { count: 1, bytes: 7 },
      totalBytes: 22,
      files: [
        { kind: "cMap", name: "a.bcmap", bytes: 10 },
        { kind: "cMap", name: "b.bcmap", bytes: 5 },
        { kind: "standardFont", name: "c.ttf", bytes: 7 },
      ],
    });
  });
});

describe("renderPreamble", () => {
  const source = renderPreamble({
    pdfModule: "/repo/packages/pdf/src/index.ts",
    runtimeModule: "/repo/tools/build/src/runtime-assets.ts",
    files: [file("cMap", "UniJIS-UCS2-H.bcmap", 1), file("standardFont", 'odd"name.ttf', 2)],
  });

  it("資産を type: file で import し、バイナリに埋め込ませる", () => {
    expect(source).toContain('import asset0 from "/pdfjs/cmaps/UniJIS-UCS2-H.bcmap" with { type: "file" };');
    expect(source).toContain('import asset1 from "/pdfjs/standard_fonts/odd\\"name.ttf" with { type: "file" };');
  });

  it("起動時に setPdfAssets へ渡す", () => {
    expect(source).toContain('import { setPdfAssets } from "/repo/packages/pdf/src/index.ts";');
    expect(source).toContain('import { embeddedPdfAssets } from "/repo/tools/build/src/runtime-assets.ts";');
    expect(source).toMatch(/setPdfAssets\(embeddedPdfAssets\(\{/);
    expect(source).toContain('"UniJIS-UCS2-H.bcmap": asset0');
    expect(source).toContain('"odd\\"name.ttf": asset1');
  });
});

describe("embeddedPdfAssets", () => {
  it("名前から埋め込み先を引いて読み、結果を使い回す", async () => {
    const reads: string[] = [];
    const assets = embeddedPdfAssets(
      { cMaps: { "UniJIS-UCS2-H.bcmap": "/$bunfs/root/a.bcmap" }, standardFonts: { "FoxitSerif.pfb": "/$bunfs/root/b.pfb" } },
      async (p) => {
        reads.push(p);
        return new Uint8Array([1, 2, 3]);
      },
    );
    expect(await assets.cMap("UniJIS-UCS2-H.bcmap")).toEqual(new Uint8Array([1, 2, 3]));
    expect(await assets.cMap("UniJIS-UCS2-H.bcmap")).toEqual(new Uint8Array([1, 2, 3]));
    expect(await assets.standardFont("FoxitSerif.pfb")).toEqual(new Uint8Array([1, 2, 3]));
    expect(reads).toEqual(["/$bunfs/root/a.bcmap", "/$bunfs/root/b.pfb"]);
  });

  it("無い名前・種類違い・プロトタイプの名前は undefined", async () => {
    const assets = embeddedPdfAssets({ cMaps: { "a.bcmap": "/a" }, standardFonts: {} }, async () => new Uint8Array([1]));
    expect(await assets.cMap("b.bcmap")).toBeUndefined();
    expect(await assets.standardFont("a.bcmap")).toBeUndefined();
    expect(await assets.cMap("toString")).toBeUndefined();
    expect(await assets.cMap("__proto__")).toBeUndefined();
  });

  it("Buffer などの Uint8Array の派生は素の Uint8Array にして返す", async () => {
    class Sub extends Uint8Array {}
    const assets = embeddedPdfAssets({ cMaps: { "a.bcmap": "/a" } }, async () => new Sub([9, 8]));
    const got = await assets.cMap("a.bcmap");
    expect(got?.constructor).toBe(Uint8Array);
    expect(Array.from(got ?? [])).toEqual([9, 8]);
  });
});

describe("collectPdfAssets（依存の pdfjs-dist）", () => {
  it("cmaps と standard_fonts を列挙し、日本語に要る CMap と標準フォントを含む", () => {
    const require = createRequire(import.meta.url);
    const root = path.dirname(require.resolve("pdfjs-dist/package.json"));
    const files = collectPdfAssets(root);
    const names = new Set(files.map((f) => f.name));
    for (const n of ["UniJIS-UCS2-H.bcmap", "Adobe-Japan1-UCS2.bcmap", "UniJIS-UTF16-H.bcmap", "LiberationSans-Regular.ttf", "FoxitSerif.pfb"]) {
      expect(names.has(n)).toBe(true);
    }
    expect(files.every((f) => f.bytes > 0 && path.isAbsolute(f.path))).toBe(true);
    expect(names.has("LICENSE")).toBe(false);
  });
});
