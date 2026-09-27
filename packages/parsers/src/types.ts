/**
 * PDF から抽出された座標付きテキスト。`packages/pdf` と同じ形（依存はさせない）。
 *
 * 座標は pdfjs の textContent item について
 * x = transform[4], y = viewport 高さ - transform[5]（ページ上端からベースラインまで）,
 * width = item.width, height = item.height。単位は PDF user space（scale 1）。
 */
export interface TextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PageItems {
  page: number;
  width: number;
  height: number;
  items: TextItem[];
}
