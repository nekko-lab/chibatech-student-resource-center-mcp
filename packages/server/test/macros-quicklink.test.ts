import { parseBusSchedule, parseClassTeachers } from "@chibatech-src/parsers";
import { PortalError } from "@chibatech-src/portal";
import { describe, expect, it } from "vitest";
import { findClassTeacher, getAcademicCalendar, getBusSchedule } from "../src/macros/quicklink.ts";
import type { Outcome } from "../src/respond.ts";
import { sampleBus, sampleTeachers, synthBusPage, synthTeacherPage } from "./helpers/layouts.ts";
import { BASE, LM, QUICK_LINKS, fakeEnv } from "./helpers/ports.ts";

function okData(o: Outcome): Record<string, unknown> {
  if (o.status !== "ok") throw new Error(`ok ではない: ${JSON.stringify(o)}`);
  return o.data;
}

const CAL = `${BASE}whole/gakubu/calendar.pdf`;
const BUS = `${BASE}whole/gakubu/bus.pdf`;
const TEACHERS = `${BASE}whole/gakubu/advisers.pdf`;

describe("合成レイアウト（前提の確認）", () => {
  it("合成バスダイヤを parsers が読める", () => {
    const s = parseBusSchedule([synthBusPage(sampleBus())]);
    expect(s.directions.map((d) => [d.from, d.to])).toEqual([
      ["模擬駅", "架空大学"],
      ["架空大学", "模擬駅"],
    ]);
    expect(s.directions[0]!.columns.map((c) => c.dayType)).toEqual(["weekday", "saturday", "holiday"]);
    expect(s.directions[0]!.columns[0]!.departures).toContainEqual({ time: "09:20", note: "経由甲" });
    expect(s.notes.filter((n) => n.startsWith("読み取れなかった"))).toEqual([]);
  });

  it("合成担任表を parsers が読める", () => {
    const t = parseClassTeachers([synthTeacherPage(sampleTeachers())]);
    expect(t.rows.map((r) => r.department)).toEqual(["架空機械学科", "模擬情報学科", "模擬情報デザイン学科"]);
    expect(t.rows[0]).toMatchObject({ faculty: "架空工学部", head: "甲野 一郎" });
    expect(t.rows[0]!.years[0]!.teachers).toEqual([
      { name: "乙川 二郎", main: true },
      { name: "丙田 三子", main: false },
    ]);
  });
});

describe("getAcademicCalendar", () => {
  it("クイックリンク「学年暦」の PDF を読み、知りたいことに当たるページに絞る", async () => {
    const { env, docs, portal } = fakeEnv();
    docs.texts.set(CAL, ["架空の前期 授業開始", "架空の後期 定期試験", "架空の休業期間"]);
    const o = await getAcademicCalendar(env, { query: "試験" });
    const d = okData(o);
    expect(d.link).toEqual({ title: "学年暦（架空）", url: CAL });
    expect((d.pages as { page: number }[]).map((p) => p.page)).toEqual([2]);
    expect(o.sources).toEqual([{ title: "学年暦（架空）", url: CAL, pages: [2], lastModified: LM }]);
    expect(portal.calls).toEqual(["quickLinks"]);
  });

  it("知りたいことが無ければ先頭から返し、当たらなければその旨を添える", async () => {
    const { env, docs } = fakeEnv();
    docs.texts.set(CAL, ["架空の前期", "架空の後期"]);
    expect((okData(await getAcademicCalendar(env, {})).pages as unknown[]).length).toBe(2);
    const d = okData(await getAcademicCalendar(env, { query: "宇宙" }));
    expect((d.pages as unknown[]).length).toBe(2);
    expect(String(d.note)).toMatch(/見つからなかった/);
  });

  it("クイックリンクに無ければ NOT_FOUND（選べる名前を details に）", async () => {
    const { env } = fakeEnv({}, undefined, { quickLinks: QUICK_LINKS.filter((l) => !l.title.includes("学年暦")) });
    const e = await getAcademicCalendar(env, {}).catch((x: unknown) => x);
    expect((e as PortalError).code).toBe("NOT_FOUND");
    expect(JSON.stringify((e as PortalError).details)).toContain("バスダイヤ");
  });
});

describe("getBusSchedule", () => {
  const setup = (now?: Date) => {
    const r = fakeEnv({}, now);
    r.docs.layouts.set(BUS, [synthBusPage(sampleBus())]);
    return r;
  };

  it("曜日区分を省略したら now から平日を決め、次の便を返す。祝日の注意を添える", async () => {
    const { env } = setup();
    const o = await getBusSchedule(env, { from: "模擬駅" });
    const d = okData(o);
    expect(d.dayType).toBe("weekday");
    expect(d.time).toBe("08:30");
    expect(d.departures).toEqual([{ time: "08:40" }, { time: "09:20", note: "経由甲" }, { time: "10:05" }]);
    expect(String(d.dayTypeNote)).toMatch(/祝日.*holiday/);
    expect(d.directions).toEqual([{ from: "模擬駅", to: "架空大学" }]);
    expect(d.footnotes).toEqual(["※架空の運休日の注意書きです。"]);
    expect(o.sources).toEqual([{ title: "バスダイヤ", url: BUS, pages: [1], lastModified: LM }]);
  });

  it("土曜・日曜は now から決める", async () => {
    const sat = okData(await getBusSchedule(setup(new Date(2099, 9, 3, 8, 0)).env, { from: "模擬駅" }));
    expect(sat.dayType).toBe("saturday");
    expect(sat.departures).toEqual([{ time: "09:00" }, { time: "11:30" }]);
    const sun = okData(await getBusSchedule(setup(new Date(2099, 9, 4, 8, 0)).env, { from: "架空大学" }));
    expect(sun.dayType).toBe("holiday");
    expect(sun.departures).toEqual([{ time: "11:50" }]);
  });

  it("曜日区分・時刻・件数を指定できる（祝日の注意は付けない）", async () => {
    const d = okData(await getBusSchedule(setup().env, { from: "架空大学", dayType: "weekday", time: "9:00", count: 1 }));
    expect(d.departures).toEqual([{ time: "10:00" }]);
    expect(d.dayTypeNote).toBeUndefined();
  });

  it("出発地が当たらなければ方向の一覧を返して聞き返す", async () => {
    const o = await getBusSchedule(setup().env, { from: "月面基地" });
    expect(o.status).toBe("needs_clarification");
    if (o.status !== "needs_clarification") return;
    expect(o.candidates).toEqual([
      { from: "模擬駅", to: "架空大学" },
      { from: "架空大学", to: "模擬駅" },
    ]);
  });

  it("時刻の形が不正なら VALIDATION", async () => {
    const e = await getBusSchedule(setup().env, { from: "模擬駅", time: "朝" }).catch((x: unknown) => x);
    expect((e as PortalError).code).toBe("VALIDATION");
  });

  it("表を読み取れなければ推測せず LAYOUT_CHANGED", async () => {
    const { env, docs } = fakeEnv();
    docs.layouts.set(BUS, [{ page: 1, width: 100, height: 100, items: [{ str: "架空の告知", x: 1, y: 1, width: 10, height: 10 }] }]);
    const e = await getBusSchedule(env, { from: "模擬駅" }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(PortalError);
    expect((e as PortalError).code).toBe("LAYOUT_CHANGED");
    expect(JSON.stringify((e as PortalError).details)).toContain("読み取れなかった");
  });
});

describe("findClassTeacher", () => {
  const setup = (profile = {}) => {
    const r = fakeEnv(profile);
    r.docs.layouts.set(TEACHERS, [synthTeacherPage(sampleTeachers())]);
    return r;
  };

  it("該当する行・年次だけを返す（ほかの学科の氏名を含めない）", async () => {
    const o = await findClassTeacher(setup().env, { department: "模擬情報学科", year: 1 });
    const d = okData(o);
    expect(d.rows).toEqual([
      { faculty: "架空工学部", department: "模擬情報学科", head: "癸 十和", years: [{ year: 1, teachers: [{ name: "子安 一葉", main: true }] }] },
    ]);
    const text = JSON.stringify(o);
    expect(text).not.toContain("甲野");
    expect(text).not.toContain("寅井");
    expect(o.sources).toEqual([{ title: "学科長・クラス担任表", url: TEACHERS, pages: [1], lastModified: LM }]);
  });

  it("プロフィールの学科コードはポータルの選択肢で名称に直してから探す", async () => {
    const { env, portal } = setup({ studentType: "undergrad", admissionYear: 2099, department: "Y2" });
    const d = okData(await findClassTeacher(env, {}));
    expect((d.rows as { department: string }[]).map((r) => r.department)).toEqual(["模擬情報学科"]);
    expect(portal.calls).toContain("departments undergrad 2099");
  });

  it("学科が無い・当たらなければ学科名の一覧を返して聞き返す", async () => {
    const none = await findClassTeacher(setup().env, {});
    expect(none.status).toBe("needs_clarification");
    const miss = await findClassTeacher(setup().env, { department: "宇宙学科" });
    expect(miss.status).toBe("needs_clarification");
    if (miss.status !== "needs_clarification") return;
    expect(miss.candidates).toEqual(["架空機械学科", "模擬情報学科", "模擬情報デザイン学科"]);
  });

  it("表を読み取れなければ LAYOUT_CHANGED", async () => {
    const { env, docs } = fakeEnv();
    docs.layouts.set(TEACHERS, [{ page: 1, width: 100, height: 100, items: [] }]);
    const e = await findClassTeacher(env, { department: "模擬情報学科" }).catch((x: unknown) => x);
    expect((e as PortalError).code).toBe("LAYOUT_CHANGED");
  });
});
