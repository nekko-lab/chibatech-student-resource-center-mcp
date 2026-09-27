import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { USER_AGENT, VERSION, depsFromEnv } from "../src/index.ts";

describe("USER_AGENT", () => {
  it("ツール名・版・非公式・リポジトリ URL を含む", async () => {
    const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    expect(VERSION).toBe(pkg.version);
    expect(USER_AGENT).toBe(
      `chibatech-src-mcp/${pkg.version} (unofficial; +https://github.com/nekko-lab/chibatech-student-resource-center-mcp)`,
    );
  });
});

describe("depsFromEnv", () => {
  it("何も無ければ空（既定はサーバ側で決める）", () => {
    expect(depsFromEnv({})).toEqual({});
  });

  it("環境変数をプロフィールと保存先に写す", () => {
    const d = depsFromEnv({
      CSRC_STUDENT_TYPE: "graduate",
      CSRC_ADMISSION_YEAR: "2025",
      CSRC_DEPARTMENT: "Q1",
      CSRC_DOWNLOAD_DIR: "/tmp/dl",
      CSRC_CACHE_DIR: "/tmp/cache",
    });
    expect(d).toEqual({
      profile: { studentType: "graduate", admissionYear: 2025, department: "Q1" },
      downloadDir: "/tmp/dl",
      cacheDir: "/tmp/cache",
    });
  });

  it("区分は日本語でも受け、年度は令和表記も読む", () => {
    const d = depsFromEnv({ CSRC_STUDENT_TYPE: "学部生", CSRC_ADMISSION_YEAR: "R6" });
    expect(d.profile).toEqual({ studentType: "undergrad", admissionYear: 2024 });
  });

  it("読めない値・空の値は捨てる（起動は止めない）", () => {
    const logs: string[] = [];
    const d = depsFromEnv(
      { CSRC_STUDENT_TYPE: "なにか", CSRC_ADMISSION_YEAR: "abc", CSRC_DEPARTMENT: "  ", CSRC_DOWNLOAD_DIR: "" },
      (m) => logs.push(m),
    );
    expect(d).toEqual({});
    expect(logs.join("\n")).toMatch(/CSRC_STUDENT_TYPE/);
    expect(logs.join("\n")).toMatch(/CSRC_ADMISSION_YEAR/);
  });

  it("mcpb が未入力の user_config を ${user_config.x} のまま渡しても無視する", () => {
    const d = depsFromEnv({ CSRC_DEPARTMENT: "${user_config.department}", CSRC_DOWNLOAD_DIR: "${user_config.download_dir}" });
    expect(d).toEqual({});
  });
});
