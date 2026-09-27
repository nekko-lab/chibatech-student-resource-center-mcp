export interface PageRange {
  from: number;
  /** 未指定なら PDF の最終ページまで（呼び出し側が pageCount で切る）。 */
  to?: number;
}

/**
 * 学科ページの項目一覧（同じ PDF の各ページを指すリンクの並び）から、
 * index 番目の項目が占めるページ範囲を推定する。
 *
 * 同じ PDF の後続項目のうち、最初にページ番号が大きくなる項目の直前ページまでを範囲とする。
 * 同じページを共有する項目が連続する場合（p13 が 2 項目など）は、そのどちらも同じ範囲になる。
 */
export function pageRangeForItem(items: readonly { url: string; page?: number }[], index: number): PageRange {
  const item = items[index];
  if (!Number.isInteger(index) || item === undefined) {
    throw new RangeError(`index ${index} is out of range (0..${items.length - 1})`);
  }
  if (item.page === undefined) return { from: 1 };

  const from = item.page;
  for (let i = index + 1; i < items.length; i++) {
    const next = items[i];
    if (next === undefined || next.url !== item.url || next.page === undefined) continue;
    if (next.page > from) return { from, to: next.page - 1 };
  }
  return { from };
}
