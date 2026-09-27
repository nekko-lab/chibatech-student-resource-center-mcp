// 開発用: dump-layout.mjs の出力（PageItems[] の JSON）を parse し、件数などの要約だけを表示する。
// 時刻・氏名などの中身は出さない（公開リポジトリに結果を残さないため）。
// 使い方: node --experimental-strip-types scripts/summarize.ts bus|teachers <layout.json> [--dump <out.json>]
import { readFileSync, writeFileSync } from "node:fs";
import { parseBusSchedule, parseClassTeachers } from "../src/index.ts";
import type { PageItems } from "../src/types.ts";

const [kind, input, flag, dumpPath] = process.argv.slice(2);
if (!kind || !input) {
  console.error("usage: summarize.ts bus|teachers <layout.json> [--dump <out.json>]");
  process.exit(2);
}
const pages = JSON.parse(readFileSync(input, "utf8")) as PageItems[];
const isWarning = (n: string) => n.startsWith("読み取れなかった");

if (kind === "bus") {
  const s = parseBusSchedule(pages);
  const summary = {
    titleFound: s.title.length > 0,
    periodFound: s.period !== undefined,
    directions: s.directions.map((d) => ({
      from: d.from,
      to: d.to,
      columns: d.columns.map((c) => ({
        dayType: c.dayType,
        departures: c.departures.length,
        withNote: c.departures.filter((x) => x.note).length,
        ascending: c.departures.every((x, i, a) => i === 0 || a[i - 1]!.time <= x.time),
        validTime: c.departures.every((x) => /^\d{2}:\d{2}$/.test(x.time)),
      })),
    })),
    footnotes: s.notes.filter((n) => !isWarning(n)).length,
    warnings: s.notes.filter(isWarning).length,
  };
  console.log(JSON.stringify(summary, null, 1));
  if (flag === "--dump" && dumpPath) writeFileSync(dumpPath, JSON.stringify(s, null, 1));
} else if (kind === "teachers") {
  const t = parseClassTeachers(pages);
  const undergrad = t.rows.filter((r) => r.years.length > 0);
  const grad = t.rows.filter((r) => r.years.length === 0);
  const teachers = undergrad.flatMap((r) => r.years.flatMap((y) => y.teachers));
  const summary = {
    titleFound: t.title.length > 0,
    legendFound: t.legend !== undefined,
    rows: t.rows.length,
    undergraduateRows: undergrad.length,
    graduateRows: grad.length,
    faculties: new Set(undergrad.map((r) => r.faculty)).size,
    schools: new Set(grad.map((r) => r.faculty)).size,
    rowsWithoutFaculty: t.rows.filter((r) => !r.faculty).length,
    rowsWithHead: t.rows.filter((r) => r.head).length,
    yearColumnsPerRow: [...new Set(undergrad.map((r) => r.years.length))],
    teacherEntries: teachers.length,
    mainTeachers: teachers.filter((x) => x.main).length,
    namesWithSpace: teachers.filter((x) => x.name.includes(" ")).length,
    emptyYearCells: undergrad.flatMap((r) => r.years).filter((y) => y.teachers.length === 0).length,
    warnings: (t.notes ?? []).length,
  };
  console.log(JSON.stringify(summary, null, 1));
  if (flag === "--dump" && dumpPath) writeFileSync(dumpPath, JSON.stringify(t, null, 1));
} else {
  console.error(`unknown kind: ${kind}`);
  process.exit(2);
}
