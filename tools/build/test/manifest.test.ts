import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  USER_CONFIG_ENV,
  buildManifest,
  mcpbLayout,
  parseToolsJson,
  renderDarwinLauncher,
  validateManifest,
  type ManifestInput,
} from "../src/manifest.ts";

const tools = [
  { name: "portal_search", description: "（非公式）検索する" },
  { name: "document_read_text", description: "（非公式）本文を読む" },
];

const input = (over: Partial<ManifestInput> = {}): ManifestInput => ({
  name: "chibatech-src-mcp",
  version: "1.2.3",
  tools,
  darwin: "universal",
  ...over,
});

const ENV = {
  CSRC_STUDENT_TYPE: "${user_config.student_type}",
  CSRC_ADMISSION_YEAR: "${user_config.admission_year}",
  CSRC_DEPARTMENT: "${user_config.department}",
  CSRC_DOWNLOAD_DIR: "${user_config.download_dir}",
};

describe("buildManifest（ユニバーサル）", () => {
  it("binary 型。macOS はユニバーサルバイナリを直接、Windows は platform_overrides で .exe を起動する", () => {
    const m = buildManifest(input());
    expect(m.manifest_version).toBe("0.3");
    expect(m.name).toBe("chibatech-src-mcp");
    expect(m.version).toBe("1.2.3");
    expect(m.server).toEqual({
      type: "binary",
      entry_point: "server/chibatech-src-mcp",
      mcp_config: {
        command: "${__dirname}/server/chibatech-src-mcp",
        args: [],
        env: ENV,
        platform_overrides: {
          win32: { command: "${__dirname}/server/chibatech-src-mcp.exe", args: [], env: ENV },
        },
      },
    });
    expect(m.tools).toEqual(tools);
  });

  it("platforms は darwin と win32（Claude Desktop に Linux 版は無い）", () => {
    expect(buildManifest(input()).compatibility).toEqual({ platforms: ["darwin", "win32"] });
  });

  it("表示名と説明に「非公式」を含め、作者とリポジトリを載せる", () => {
    const m = buildManifest(input());
    expect(m.display_name).toContain("非公式");
    expect(m.description).toContain("非公式");
    expect(m.author.name).toBe("nekko-lab");
    expect(m.repository).toEqual({ type: "git", url: "https://github.com/nekko-lab/chibatech-student-resource-center-mcp" });
  });

  it("user_config は 区分・入学年度・学科・保存先フォルダの 4 つで、すべて任意", () => {
    const m = buildManifest(input());
    expect(Object.keys(m.user_config)).toEqual(["student_type", "admission_year", "department", "download_dir"]);
    expect(m.user_config.student_type?.type).toBe("string");
    expect(m.user_config.admission_year?.type).toBe("number");
    expect(m.user_config.department?.type).toBe("string");
    expect(m.user_config.download_dir?.type).toBe("directory");
    for (const field of Object.values(m.user_config)) {
      expect(field.required).toBe(false);
      expect(field.title.length).toBeGreaterThan(0);
      expect(field.description.length).toBeGreaterThan(0);
    }
  });

  it("環境変数名の対応表", () => {
    expect(USER_CONFIG_ENV).toEqual({
      student_type: "CSRC_STUDENT_TYPE",
      admission_year: "CSRC_ADMISSION_YEAR",
      department: "CSRC_DEPARTMENT",
      download_dir: "CSRC_DOWNLOAD_DIR",
    });
  });

  it("検証に通らない入力は例外にする", () => {
    expect(() => buildManifest(input({ version: "v1.2" }))).toThrow(/version/);
    expect(() => buildManifest(input({ tools: [] }))).toThrow(/tools/);
    expect(() => buildManifest(input({ name: "Bad Name" }))).toThrow(/name/);
  });
});

describe("buildManifest（代替: 起動スクリプト）", () => {
  it("macOS は /bin/sh で launch.sh を起動し、Windows は .exe を直接（args は空に戻す）", () => {
    const m = buildManifest(input({ darwin: "launcher" }));
    expect(m.server.entry_point).toBe("server/launch.sh");
    expect(m.server.mcp_config.command).toBe("/bin/sh");
    expect(m.server.mcp_config.args).toEqual(["${__dirname}/server/launch.sh"]);
    expect(m.server.mcp_config.platform_overrides.win32).toEqual({
      command: "${__dirname}/server/chibatech-src-mcp.exe",
      args: [],
      env: ENV,
    });
    expect(validateManifest(m)).toEqual([]);
  });

  it("launch.sh は uname -m で arm64 / x64 を選ぶ", () => {
    const s = renderDarwinLauncher("chibatech-src-mcp");
    expect(s.startsWith("#!/bin/sh\n")).toBe(true);
    expect(s).toContain("uname -m");
    expect(s).toContain('exec "$dir/chibatech-src-mcp-arm64" "$@"');
    expect(s).toContain('exec "$dir/chibatech-src-mcp-x64" "$@"');
  });
});

describe("mcpbLayout", () => {
  it("ユニバーサル: server/<名前> と server/<名前>.exe", () => {
    expect(mcpbLayout("n", "universal")).toEqual({
      entries: [
        { path: "server/n", from: "darwin-universal", executable: true },
        { path: "server/n.exe", from: "windows-x64", executable: false },
      ],
      launcher: undefined,
    });
  });

  it("起動スクリプト: launch.sh と arm64 / x64 の 2 つ、server/<名前>.exe", () => {
    expect(mcpbLayout("n", "launcher")).toEqual({
      entries: [
        { path: "server/n-arm64", from: "darwin-arm64", executable: true },
        { path: "server/n-x64", from: "darwin-x64", executable: true },
        { path: "server/n.exe", from: "windows-x64", executable: false },
      ],
      launcher: "server/launch.sh",
    });
  });
});

describe("validateManifest", () => {
  const ok = () => structuredClone(buildManifest(input()));

  it("正しいものは誤りが 0 件", () => {
    expect(validateManifest(ok())).toEqual([]);
  });

  it("semver 以外の version を拒む（pre-release は可）", () => {
    expect(validateManifest({ ...ok(), version: "1.2" })).not.toEqual([]);
    expect(validateManifest({ ...ok(), version: "0.0.0-dev.12" })).toEqual([]);
  });

  it("「非公式」を含まない表示名を拒む", () => {
    expect(validateManifest({ ...ok(), display_name: "千葉工業大学 学生資料室 MCP" }).join()).toMatch(/display_name/);
  });

  it("entry_point と command の食い違いを拒む", () => {
    const m = ok();
    m.server.mcp_config.command = "${__dirname}/server/other";
    expect(validateManifest(m).join()).toMatch(/command/);
  });

  it("env が存在しない user_config を参照したら拒む", () => {
    const m = ok();
    m.server.mcp_config.env.CSRC_X = "${user_config.nope}";
    expect(validateManifest(m).join()).toMatch(/nope/);
  });

  it("platforms は darwin と win32 の 2 つ（linux を入れない）", () => {
    const m = ok();
    m.compatibility.platforms = ["darwin", "win32", "linux"];
    expect(validateManifest(m).join()).toMatch(/platforms/);
    m.compatibility.platforms = ["darwin"];
    expect(validateManifest(m).join()).toMatch(/platforms/);
  });

  it("win32 の上書きが無い・.exe でない・env が本体と違えば拒む", () => {
    const noOverride = ok();
    delete (noOverride.server.mcp_config.platform_overrides as { win32?: unknown }).win32;
    expect(validateManifest(noOverride).join()).toMatch(/win32/);

    const notExe = ok();
    notExe.server.mcp_config.platform_overrides.win32.command = "${__dirname}/server/chibatech-src-mcp";
    expect(validateManifest(notExe).join()).toMatch(/\.exe/);

    const envDiff = ok();
    envDiff.server.mcp_config.platform_overrides.win32.env = {};
    expect(validateManifest(envDiff).join()).toMatch(/env/);

    const withArgs = ok();
    withArgs.server.mcp_config.platform_overrides.win32.args = ["x"];
    expect(validateManifest(withArgs).join()).toMatch(/args/);
  });

  it("win32 以外の上書きを拒む", () => {
    const m = ok() as unknown as { server: { mcp_config: { platform_overrides: Record<string, unknown> } } };
    m.server.mcp_config.platform_overrides.linux = { command: "x" };
    expect(validateManifest(m as never).join()).toMatch(/linux/);
  });

  it("ツール名の重複・形式違反・説明なしを拒む", () => {
    expect(validateManifest({ ...ok(), tools: [tools[0]!, tools[0]!] }).join()).toMatch(/重複/);
    expect(validateManifest({ ...ok(), tools: [{ name: "has space", description: "x" }] }).join()).toMatch(/has space/);
    expect(validateManifest({ ...ok(), tools: [{ name: "a", description: "" }] }).join()).toMatch(/description/);
  });

  it("user_config は required: true を持たない", () => {
    const m = ok();
    m.user_config.department!.required = true;
    expect(validateManifest(m).join()).toMatch(/department/);
  });
});

describe("parseToolsJson", () => {
  it("{ name, description } の配列を読む（余計な項目は落とす）", () => {
    expect(parseToolsJson('[{"name":"a_b","description":"x","inputSchema":{}}]')).toEqual([{ name: "a_b", description: "x" }]);
  });

  it("形が違えば例外", () => {
    expect(() => parseToolsJson("{}")).toThrow(/配列/);
    expect(() => parseToolsJson('[{"name":"a"}]')).toThrow(/description/);
    expect(() => parseToolsJson("not json")).toThrow();
  });

  it("検証用の PoC のツール一覧（fixtures/poc-tools.json）を読める", () => {
    const text = readFileSync(new URL("../fixtures/poc-tools.json", import.meta.url), "utf8");
    expect(parseToolsJson(text).map((t) => t.name)).toEqual(["portal_search", "portal_list_sections", "document_read_text"]);
  });
});
