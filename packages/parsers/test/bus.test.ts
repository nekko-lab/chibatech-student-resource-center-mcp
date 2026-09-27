import { describe, expect, it } from "vitest";
import { nextBuses, parseBusSchedule, type BusSchedule } from "../src/index.ts";
import { makeBusPage, sampleBusFixture, type BusFixture, type FixtureColumn } from "./fixtures/bus-generator.ts";

const pad = (n: number) => String(n).padStart(2, "0");

/** 生成器の入力から期待される発車時刻の列を組み立てる */
function expectedDepartures(col: FixtureColumn) {
  return Object.entries(col.departures)
    .flatMap(([h, deps]) =>
      deps.map((d) => (d.note ? { time: `${pad(Number(h))}:${pad(d.min)}`, note: d.note } : { time: `${pad(Number(h))}:${pad(d.min)}` })),
    )
    .sort((a, b) => a.time.localeCompare(b.time));
}

function expectMatchesFixture(s: BusSchedule, f: BusFixture) {
  expect(s.directions).toHaveLength(2);
  const dirs = [f.left, f.right];
  dirs.forEach((fd, i) => {
    const d = s.directions[i]!;
    expect(d.from).toBe(fd.from);
    expect(d.to).toBe(fd.to);
    expect(d.columns).toHaveLength(fd.columns.length);
    fd.columns.forEach((fc, j) => {
      expect(d.columns[j]!.departures).toEqual(expectedDepartures(fc));
    });
  });
}

describe("parseBusSchedule", () => {
  const fixture = sampleBusFixture();
  const schedule = parseBusSchedule([makeBusPage(fixture)]);

  it("タイトル（字間の空白を詰める）と期間を読む", () => {
    expect(schedule.title).toBe("令和９年度前期バスダイヤ");
    expect(schedule.period).toBe("令和9年4月8日（木）～令和9年7月30日（金）");
  });

  it("時刻列の左右を 2 方向として読み、発・行を分ける", () => {
    expect(schedule.directions.map((d) => [d.from, d.to])).toEqual([
      ["津田沼", "新習志野"],
      ["新習志野", "津田沼"],
    ]);
  });

  it("曜日区分の列を時刻列に近い順に読み、縦積み・均等割付の見出しを 1 つのラベルにする", () => {
    for (const d of schedule.directions) {
      expect(d.columns.map((c) => [c.dayType, c.label])).toEqual([
        ["weekday", "平日"],
        ["saturday", "土曜"],
        ["holiday", "日曜日・祝日・休日"],
        ["special", "１２月24日（金）"],
      ]);
    }
  });

  it("分を HH:MM に復元し、昇順に並べ、注記（割れた注記を含む）を分に結びつける", () => {
    expectMatchesFixture(schedule, fixture);
    const weekday = schedule.directions[0]!.columns[0]!;
    expect(weekday.departures).toContainEqual({ time: "09:25", note: "茜40" });
  });

  it("表の下の脚注を notes に入れ、読めなかった箇所がなければ警告を出さない", () => {
    expect(schedule.notes).toEqual([
      "※茜浜経由は、（茜）の時刻に途中の停留所を出発します。",
      "※架空の運休期間の注意書きです。",
    ]);
  });

  it("列幅・位置・行間が変わっても同じ結果になる（固定の座標に依存しない）", () => {
    const moved = sampleBusFixture({
      geometry: { hourX: 430, hourGap: 22, columnWidths: [70, 95, 64, 44], rowPitch: 19.5, firstRowY: 190, slots: 2 },
    });
    const s = parseBusSchedule([makeBusPage(moved)]);
    expectMatchesFixture(s, moved);
    expect(s.directions[1]!.columns.map((c) => c.dayType)).toEqual(["weekday", "saturday", "holiday", "special"]);
  });

  it("特定日の列が無い年度（曜日区分 3 列）も読める", () => {
    const base = sampleBusFixture();
    const three: BusFixture = {
      ...base,
      left: { ...base.left, columns: base.left.columns.slice(0, 3) },
      right: { ...base.right, columns: base.right.columns.slice(0, 3) },
    };
    const s = parseBusSchedule([makeBusPage(three)]);
    expectMatchesFixture(s, three);
    expect(s.directions[0]!.columns.map((c) => c.dayType)).toEqual(["weekday", "saturday", "holiday"]);
  });

  it("表の中の解釈できない文字は握りつぶさず notes に「読み取れなかった」として残す", () => {
    const page = makeBusPage(fixture);
    const weekdayMinute = page.items.find((i) => i.str === "05")!;
    page.items.push({ str: "運休?", x: weekdayMinute.x, y: weekdayMinute.y + 23.8 * 2, width: 20, height: 9.4 });
    const s = parseBusSchedule([page]);
    expect(s.notes.some((n) => n.includes("読み取れなかった") && n.includes("運休?"))).toBe(true);
    expectMatchesFixture(s, fixture);
  });

  it("表が見つからないときは例外にせず、空の directions と理由を返す", () => {
    const s = parseBusSchedule([{ page: 1, width: 100, height: 100, items: [{ str: "無関係", x: 1, y: 1, width: 10, height: 10 }] }]);
    expect(s.directions).toEqual([]);
    expect(s.notes.some((n) => n.includes("読み取れなかった"))).toBe(true);
    expect(parseBusSchedule([]).directions).toEqual([]);
  });
});

describe("nextBuses", () => {
  const s = parseBusSchedule([makeBusPage(sampleBusFixture())]);

  it("指定時刻以降の発車を count 件返す（注記付き）", () => {
    expect(nextBuses(s, { from: "津田沼", dayType: "weekday", now: "08:30", count: 3 })).toEqual([
      { time: "08:45" },
      { time: "09:25", note: "茜40" },
      { time: "11:00" },
    ]);
  });

  it("count の既定は 3、ちょうどの時刻も含み、H:MM も受け付ける", () => {
    expect(nextBuses(s, { from: "津田沼", dayType: "weekday", now: "11:00" })).toEqual([
      { time: "11:00" },
      { time: "11:30" },
      { time: "12:15" },
    ]);
    expect(nextBuses(s, { from: "津田沼", dayType: "weekday", now: "9:00", count: 1 })).toEqual([{ time: "09:25", note: "茜40" }]);
  });

  it("from は部分一致（「駅」「発」付き・一部だけでもよい）", () => {
    expect(nextBuses(s, { from: "新習志野駅", dayType: "saturday", now: "00:00" })).toEqual([{ time: "11:15" }]);
    expect(nextBuses(s, { from: "習志野", dayType: "holiday", now: "00:00" })).toEqual([{ time: "11:45" }]);
    expect(nextBuses(s, { from: "津田沼発", dayType: "special", now: "09:00" })).toEqual([{ time: "09:50" }]);
  });

  it("該当がなければ空配列", () => {
    expect(nextBuses(s, { from: "津田沼", dayType: "weekday", now: "23:00" })).toEqual([]);
    expect(nextBuses(s, { from: "千葉", dayType: "weekday", now: "08:00" })).toEqual([]);
  });

  it("時刻の書式が不正なら RangeError", () => {
    expect(() => nextBuses(s, { from: "津田沼", dayType: "weekday", now: "8時" })).toThrow(RangeError);
  });
});
