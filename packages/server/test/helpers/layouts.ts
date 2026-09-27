/**
 * バスダイヤ・担任表と同じ「形」をした座標付きテキスト（PageItems）の合成器。
 * packages/parsers/test/fixtures/*-generator.ts の考え方（見出し語で列を示し、内容は列の中に置く）に倣った簡易版。
 * 地名・時刻・氏名はすべて架空。
 */
import type { PageItems, TextItem } from "@chibatech-src/pdf";

const item = (str: string, x: number, y: number, font: number): TextItem => ({
  str,
  x,
  y,
  width: [...str].length * font,
  height: font,
});

export interface SynthBusColumn {
  header: string;
  /** 時 → 分（注記付きは [分, 注記]） */
  departures: Record<number, (number | [number, string])[]>;
}

export interface SynthBus {
  title: string;
  period: string;
  hours: number[];
  left: { from: string; to: string; columns: SynthBusColumn[] };
  right: { from: string; to: string; columns: SynthBusColumn[] };
  footnotes: string[];
}

/** 時刻列を中央に、左右に方向ブロック・曜日区分の列を置く 1 ページ */
export function synthBusPage(b: SynthBus): PageItems {
  const F = 9;
  const hourX = 400;
  const colW = 80;
  const gap = 30;
  const items: TextItem[] = [];
  items.push(item(b.title, 100, 60, 14));
  items.push(item(b.period, 520, 60, 10));

  const side = (s: "left" | "right", d: SynthBus["left"]) => {
    const spanX0 = s === "left" ? hourX - gap - colW * d.columns.length : hourX + gap;
    items.push(item(`${d.from}発`, spanX0 + 20, 100, 11));
    items.push(item(`${d.to}行`, spanX0 + 20, 120, 11));
    d.columns.forEach((c, i) => {
      const x0 = s === "left" ? hourX - gap - colW * (i + 1) : hourX + gap + colW * i;
      const inner = s === "left" ? x0 + colW : x0;
      items.push(item(c.header, x0 + colW / 2 - ([...c.header].length * 10) / 2, 150, 10));
      for (const [h, deps] of Object.entries(c.departures)) {
        const r = b.hours.indexOf(Number(h));
        if (r < 0) throw new Error(`hour ${h} is not in hours`);
        const rowY = 180 + r * 24;
        deps
          .map((d) => (Array.isArray(d) ? d : ([d, undefined] as const)))
          .sort((p, q) => p[0] - q[0])
          .forEach(([min, note], j) => {
            const cx = s === "left" ? inner - (j + 0.5) * (colW / 2) : inner + (j + 0.5) * (colW / 2);
            const text = String(min).padStart(2, "0");
            items.push(item(text, cx - F, note ? rowY - 4 : rowY, F));
            if (note) items.push(item(`（${note}）`, cx - 14, rowY + 8, 6));
          });
      }
    });
  };
  side("left", b.left);
  side("right", b.right);

  items.push(item("時刻", hourX - 10, 135, 10));
  b.hours.forEach((h, r) => items.push(item(String(h), hourX - 5, 180 + r * 24, F)));

  const last = 180 + (b.hours.length - 1) * 24;
  b.footnotes.forEach((t, i) => items.push(item(`※${t}`, 100, last + 30 + i * 18, 10)));
  return { page: 1, width: 841, height: 595, items };
}

/** 架空の標準ダイヤ */
export function sampleBus(): SynthBus {
  return {
    title: "架空年度前期バスダイヤ",
    period: "2099年4月1日～2099年7月31日",
    hours: [8, 9, 10, 11],
    left: {
      from: "模擬駅",
      to: "架空大学",
      columns: [
        { header: "平日", departures: { 8: [10, 40], 9: [[20, "経由甲"]], 10: [5] } },
        { header: "土曜", departures: { 9: [0], 11: [30] } },
        { header: "休日", departures: { 10: [15] } },
      ],
    },
    right: {
      from: "架空大学",
      to: "模擬駅",
      columns: [
        { header: "平日", departures: { 8: [25], 10: [0, 45] } },
        { header: "土曜", departures: { 11: [10] } },
        { header: "休日", departures: { 11: [50] } },
      ],
    },
    footnotes: ["架空の運休日の注意書きです。"],
  };
}

export interface SynthTeacherDept {
  name: string;
  head: string;
  /** 1〜4 年次（"◎" で始まる氏名は主担任） */
  years: string[][];
}

export interface SynthTeachers {
  title: string;
  faculty: string;
  departments: SynthTeacherDept[];
}

/** 見出し行「学部 / 学科 / 学科長 / 1〜4年次」と学科の行を置く 1 ページ */
export function synthTeacherPage(t: SynthTeachers): PageItems {
  const F = 7;
  const items: TextItem[] = [];
  items.push(item(t.title, 150, 25, 10));
  items.push(item("◎：主担任", 80, 40, F));
  const yearX = [280, 340, 400, 460];
  items.push(item("学部", 60, 60, F));
  items.push(item("学科", 130, 60, F));
  items.push(item("学科長", 210, 60, F));
  yearX.forEach((x, i) => items.push(item(`${i + 1}年次`, x, 60, F)));

  const name = (full: string, x: number, y: number) => {
    const [sur = "", given] = full.split(" ");
    items.push(item(sur, x - (sur.startsWith("◎") ? F : 0), y, F));
    if (given) items.push(item(given, x + 20, y, F));
  };
  const centers = t.departments.map((_, i) => 90 + i * 30);
  t.departments.forEach((d, i) => {
    const c = centers[i]!;
    items.push(item(d.name, 120, c, F));
    name(d.head, 205, c);
    d.years.forEach((names, yi) => {
      names.forEach((n, k) => name(n, (yearX[yi] ?? 0) - 10, c + (k - (names.length - 1) / 2) * 12));
    });
  });
  const mid = ((centers[0] ?? 90) + (centers[centers.length - 1] ?? 90)) / 2;
  items.push(item(t.faculty, 40, mid, F));
  return { page: 1, width: 595, height: 841, items };
}

export function sampleTeachers(): SynthTeachers {
  return {
    title: "2099年度 架空学科長・クラス担任表",
    faculty: "架空工学部",
    departments: [
      {
        name: "架空機械学科",
        head: "甲野 一郎",
        years: [["◎乙川 二郎", "丙田 三子"], ["◎丁原 四季"], ["己島 六花"], ["辛木 八雲"]],
      },
      {
        name: "模擬情報学科",
        head: "癸 十和",
        years: [["◎子安 一葉"], ["寅井 三葉"], ["卯月 四葉"], ["辰巳 五葉"]],
      },
      {
        name: "模擬情報デザイン学科",
        head: "午後 六葉",
        years: [["未明 七葉"], ["申田 八葉"], [], ["酉島 九葉"]],
      },
    ],
  };
}
