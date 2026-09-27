/**
 * ページ単位の 2-gram 転置索引。候補の絞り込みだけに使い、最後は正規化後の部分一致で確かめる（rank.ts）。
 */
import { bigramsOf, normalizeText } from "./text.ts";

export interface SourcePage {
  page: number;
  /** 抽出したままの本文（抜粋に使う） */
  text: string;
  /** 正規化済みの本文（無ければ作る） */
  norm?: string;
}

export interface SourceDoc {
  url: string;
  pages: SourcePage[];
}

export interface PageRef {
  /** 索引の中の通し番号 */
  id: number;
  url: string;
  page: number;
  text: string;
  norm: string;
}

export class BigramIndex {
  readonly pages: readonly PageRef[];
  readonly #postings: Map<string, number[]>;

  private constructor(pages: PageRef[], postings: Map<string, number[]>) {
    this.pages = pages;
    this.#postings = postings;
  }

  static build(docs: readonly SourceDoc[]): BigramIndex {
    const pages: PageRef[] = [];
    const postings = new Map<string, number[]>();
    for (const d of docs) {
      for (const p of d.pages) {
        const id = pages.length;
        const norm = p.norm ?? normalizeText(p.text);
        pages.push({ id, url: d.url, page: p.page, text: p.text, norm });
        for (const g of bigramsOf(norm)) {
          const list = postings.get(g);
          if (list) list.push(id);
          else postings.set(g, [id]);
        }
      }
    }
    return new BigramIndex(pages, postings);
  }

  /** 異なる 2-gram の数 */
  get size(): number {
    return this.#postings.size;
  }

  /**
   * 正規化済みの語の 2-gram をすべて含むページ（id 順）。部分一致かどうかは確かめない。
   * 1 文字の語は 2-gram で絞れないので、全ページを舐めてその文字を含むものを返す。
   */
  candidates(needle: string): PageRef[] {
    if (needle.length === 0) return [];
    if (needle.length === 1) return this.pages.filter((p) => p.norm.includes(needle));
    const lists: number[][] = [];
    for (const g of bigramsOf(needle)) {
      const l = this.#postings.get(g);
      if (!l) return [];
      lists.push(l);
    }
    lists.sort((a, b) => a.length - b.length);
    let acc = lists[0]!;
    for (const l of lists.slice(1)) {
      acc = intersectSorted(acc, l);
      if (acc.length === 0) return [];
    }
    return acc.map((id) => this.pages[id]!);
  }
}

function intersectSorted(a: number[], b: number[]): number[] {
  const out: number[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const x = a[i]!;
    const y = b[j]!;
    if (x === y) {
      out.push(x);
      i++;
      j++;
    } else if (x < y) i++;
    else j++;
  }
  return out;
}
