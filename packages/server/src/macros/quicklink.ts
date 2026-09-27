/**
 * ホームのクイックリンクを起点にするマクロ: get_academic_calendar / get_bus_schedule / find_class_teacher
 */
import { normalizeJa, resolveDepartment } from "@chibatech-src/match";
import {
  findTeachers,
  nextBuses,
  parseBusSchedule,
  parseClassTeachers,
  type BusSchedule,
  type DayType,
  type SchoolYear,
} from "@chibatech-src/parsers";
import { PortalError, type QuickLink } from "@chibatech-src/portal";
import { clarify, ok, type Outcome, type Source } from "../respond.ts";
import type { MacroEnv } from "./ports.ts";
import { findQuickLink, pagesMatching } from "./resolve.ts";

/** クイックリンクの名前の候補（先に書いたものから試す） */
export const CALENDAR_ALIASES = ["学年暦", "年間行事予定", "行事予定", "年間予定"] as const;
export const BUS_ALIASES = ["バスダイヤ", "バス時刻表", "スクールバス", "バス", "シャトル"] as const;
export const TEACHER_ALIASES = ["クラス担任", "担任"] as const;

const UNREAD = "読み取れなかった";

async function pdfQuickLink(env: MacroEnv, aliases: readonly string[], what: string): Promise<QuickLink> {
  const home = await env.portal.quickLinks();
  const link = findQuickLink(home.items, aliases, what);
  if (link.kind !== "pdf") {
    throw new PortalError("LAYOUT_CHANGED", `クイックリンク「${link.title}」が PDF ではありません`, {
      selector: "quick link (pdf)",
      title: link.title,
      url: link.url,
      kind: link.kind,
    });
  }
  return link;
}

export async function getAcademicCalendar(env: MacroEnv, args: { query?: string | undefined }): Promise<Outcome> {
  const home = await env.portal.quickLinks();
  const link = findQuickLink(home.items, CALENDAR_ALIASES, "学年暦");
  const linkInfo = { title: link.title, url: link.url };
  if (link.kind !== "pdf") {
    return ok(
      { link: { ...linkInfo, kind: link.kind }, note: "学年暦が PDF ではないため本文は返しません。portal_open_quick_link で開いてください" },
      [{ title: link.title, url: link.url, lastModified: home.lastModified }],
    );
  }
  const read = await env.docs.readText(link.url, { from: 1, limits: { maxPages: 6 } });
  let pages = read.pages;
  let note: string | undefined;
  const q = args.query?.trim();
  if (q) {
    const hit = pagesMatching(q, pages);
    if (hit) pages = pages.filter((p) => hit.includes(p.page));
    else note = `「${q}」に当たるページが見つからなかったため、先頭から返します`;
  }
  const data: Record<string, unknown> = { link: linkInfo, pageCount: read.pageCount, pages };
  if (link.updated) data.updated = link.updated;
  if (note) data.note = note;
  if (read.next) data.next = read.next;
  const src: Source = { title: link.title, url: read.url, pages: pages.map((p) => p.page), lastModified: read.lastModified };
  return ok(data, [src]);
}

const placeKey = (s: string) => normalizeJa(s).replace(/(駅|発|行|バス停)$/g, "");

/** nextBuses と同じ規則（部分一致）で、出発地に当たる方向を返す */
function matchDirections(s: BusSchedule, from: string): BusSchedule["directions"] {
  const key = placeKey(from);
  if (!key) return [];
  return s.directions.filter((d) => {
    const f = placeKey(d.from);
    return f !== "" && (f.includes(key) || key.includes(f));
  });
}

function dayTypeOf(d: Date): DayType {
  const w = d.getDay();
  if (w === 0) return "holiday";
  if (w === 6) return "saturday";
  return "weekday";
}

const pad2 = (n: number) => String(n).padStart(2, "0");

export async function getBusSchedule(
  env: MacroEnv,
  args: { from?: string | undefined; dayType?: DayType | undefined; time?: string | undefined; count?: number | undefined },
): Promise<Outcome> {
  const now = env.now();
  const time = args.time?.trim() || `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  const m = time.normalize("NFKC").match(/^(\d{1,2}):(\d{2})$/);
  if (!m || Number(m[1]) > 29 || Number(m[2]) > 59) {
    throw new PortalError("VALIDATION", `時刻は "HH:MM" の形で指定してください: ${time}`, { time });
  }
  const hhmm = `${pad2(Number(m[1]))}:${m[2]}`;

  const link = await pdfQuickLink(env, BUS_ALIASES, "バスダイヤ");
  const read = await env.docs.readItems(link.url, { maxPages: 4 });
  const schedule = parseBusSchedule(read.pages);
  const unread = schedule.notes.filter((n) => n.startsWith(UNREAD));
  if (schedule.directions.length === 0) {
    throw new PortalError("LAYOUT_CHANGED", "バスダイヤの表を読み取れませんでした", { url: read.url, notes: unread });
  }
  const source: Source = { title: link.title, url: read.url, pages: read.pages.map((p) => p.page), lastModified: read.lastModified };
  const directions = schedule.directions.map((d) => ({ from: d.from, to: d.to }));

  const from = args.from?.trim();
  const matched = from ? matchDirections(schedule, from) : [];
  if (!from || matched.length === 0) {
    const q = from ? `出発地「${from}」がバスダイヤに見つかりません。どの方向ですか` : "どこから乗りますか（出発地を選んでください）";
    return clarify(q, directions, [source]);
  }

  const dayType = args.dayType ?? dayTypeOf(now);
  const departures = nextBuses(schedule, { from, dayType, now: hhmm, count: args.count ?? 3 });
  const specialDays = matched.flatMap((d) => d.columns.filter((c) => c.dayType === "special").map((c) => c.label));
  const data: Record<string, unknown> = {
    title: schedule.title,
    directions: matched.map((d) => ({ from: d.from, to: d.to })),
    dayType,
    time: hhmm,
    departures,
    footnotes: schedule.notes.filter((n) => !n.startsWith(UNREAD)),
  };
  if (schedule.period) data.period = schedule.period;
  if (!args.dayType) {
    data.dayTypeNote = "曜日区分は日付から平日・土曜・日曜を決めました。祝日・休日は判定できないため、祝日なら dayType に holiday を指定してください";
  }
  if (specialDays.length > 0) data.specialDays = [...new Set(specialDays)];
  if (unread.length > 0) data.unreadParts = unread;
  if (departures.length === 0) data.note = "指定の時刻以降の便はこの表にありません";
  return ok(data, [source]);
}

const CODE_LIKE = /^[0-9A-Za-z]{1,3}$/;

export async function findClassTeacher(
  env: MacroEnv,
  args: { department?: string | undefined; year?: SchoolYear | undefined },
): Promise<Outcome> {
  const link = await pdfQuickLink(env, TEACHER_ALIASES, "担任表");
  const read = await env.docs.readItems(link.url, { maxPages: 8 });
  const table = parseClassTeachers(read.pages);
  const unread = (table.notes ?? []).filter((n) => n.startsWith(UNREAD));
  if (table.rows.length === 0) {
    throw new PortalError("LAYOUT_CHANGED", "担任表を読み取れませんでした", { url: read.url, notes: unread });
  }
  const source: Source = { title: link.title, url: read.url, pages: read.pages.map((p) => p.page), lastModified: read.lastModified };
  const names = [...new Set(table.rows.map((r) => r.department))];

  let query = args.department?.trim();
  if (!query && env.profile.department) {
    query = env.profile.department;
    // プロフィールの学科がコードなら、ポータルの選択肢で名称に直す
    const p = env.profile;
    if (CODE_LIKE.test(query) && p.studentType && p.admissionYear) {
      const opts = await env.portal.departments(p.studentType, p.admissionYear).catch(() => []);
      const hit = opts.find((o) => o.code.toUpperCase() === query!.toUpperCase());
      if (hit) query = hit.name;
    }
  }
  if (!query) return clarify("どの学科・専攻の担任を調べますか", names, [source]);

  const options = names.map((name) => ({ code: "", name }));
  const r = resolveDepartment(query, options);
  let department: string | undefined = r.best?.name;
  if (!department && r.ambiguous) {
    return clarify(`「${query}」に当たる学科・専攻が複数あります。どれですか`, [...new Set(r.candidates.map((c) => c.item.name))], [source]);
  }
  if (!department && findTeachers(table, { department: query }).length > 0) department = query;
  if (!department) return clarify(`「${query}」に当たる学科・専攻が担任表に見つかりません。次から選んでください`, names, [source]);

  const rows = findTeachers(table, { department, ...(args.year ? { year: args.year } : {}) });
  const data: Record<string, unknown> = { title: table.title, department, rows };
  if (args.year) data.year = args.year;
  if (table.legend) data.legend = table.legend;
  if (rows.length === 0) data.note = `${args.year ?? ""}年次の担任は表にありません`;
  if (unread.length > 0) data.unreadParts = unread;
  return ok(data, [source]);
}
