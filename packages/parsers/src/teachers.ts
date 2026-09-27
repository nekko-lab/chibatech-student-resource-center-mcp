import type { PageItems } from "./types.ts";

export interface TeacherTable {
  title: string;
  legend?: string;
  rows: {
    faculty?: string;
    department: string;
    head?: string;
    years: { year: 1 | 2 | 3 | 4; teachers: { name: string; main: boolean }[] }[];
  }[];
  /** 読み取れなかった箇所（指定の形への追加。省略可能なので既存の形と互換） */
  notes?: string[];
}

export function parseClassTeachers(_pages: PageItems[]): TeacherTable {
  throw new Error("not implemented");
}

export function findTeachers(_t: TeacherTable, _q: { department: string; year?: 1 | 2 | 3 | 4 }): TeacherTable["rows"] {
  throw new Error("not implemented");
}
