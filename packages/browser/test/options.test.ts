import { describe, expect, it } from "vitest";
import { optionsFromEnv, resolveOptions } from "../src/index.ts";

describe("optionsFromEnv", () => {
  it("何も設定されていなければ空（既定値は acquireBrowser 側で補う）", () => {
    expect(optionsFromEnv({})).toEqual({});
  });

  it("CSRC_CHANNELS を順序どおりに読む", () => {
    expect(optionsFromEnv({ CSRC_CHANNELS: "msedge" })).toEqual({ channels: ["msedge"] });
    expect(optionsFromEnv({ CSRC_CHANNELS: "chrome,msedge" })).toEqual({ channels: ["chrome", "msedge"] });
    expect(optionsFromEnv({ CSRC_CHANNELS: "msedge,chrome" })).toEqual({ channels: ["msedge", "chrome"] });
  });

  it("CSRC_CHANNELS の空白・大文字・重複を整える", () => {
    expect(optionsFromEnv({ CSRC_CHANNELS: " MSEdge , chrome ,msedge" })).toEqual({ channels: ["msedge", "chrome"] });
  });

  it("CSRC_CHANNELS の未知の名前は捨て、有効なものが残らなければ既定に任せる", () => {
    expect(optionsFromEnv({ CSRC_CHANNELS: "firefox,msedge" })).toEqual({ channels: ["msedge"] });
    expect(optionsFromEnv({ CSRC_CHANNELS: "firefox" })).toEqual({});
    expect(optionsFromEnv({ CSRC_CHANNELS: "" })).toEqual({});
    expect(optionsFromEnv({ CSRC_CHANNELS: " , " })).toEqual({});
  });

  it("CSRC_DISABLE_CHANNELS は 1 / true のときだけ有効", () => {
    expect(optionsFromEnv({ CSRC_DISABLE_CHANNELS: "1" })).toEqual({ disableChannels: true });
    expect(optionsFromEnv({ CSRC_DISABLE_CHANNELS: "true" })).toEqual({ disableChannels: true });
    expect(optionsFromEnv({ CSRC_DISABLE_CHANNELS: " TRUE " })).toEqual({ disableChannels: true });
    expect(optionsFromEnv({ CSRC_DISABLE_CHANNELS: "0" })).toEqual({});
    expect(optionsFromEnv({ CSRC_DISABLE_CHANNELS: "" })).toEqual({});
    expect(optionsFromEnv({ CSRC_DISABLE_CHANNELS: "yes" })).toEqual({});
  });

  it("CSRC_INSTALL_MODE は auto / registry / custom（大文字小文字を問わない）", () => {
    expect(optionsFromEnv({ CSRC_INSTALL_MODE: "auto" })).toEqual({ installMode: "auto" });
    expect(optionsFromEnv({ CSRC_INSTALL_MODE: "registry" })).toEqual({ installMode: "registry" });
    expect(optionsFromEnv({ CSRC_INSTALL_MODE: " Custom " })).toEqual({ installMode: "custom" });
  });

  it("CSRC_INSTALL_MODE の未知の値は無視する（既定の auto になる）", () => {
    expect(optionsFromEnv({ CSRC_INSTALL_MODE: "npm" })).toEqual({});
    expect(optionsFromEnv({ CSRC_INSTALL_MODE: "" })).toEqual({});
  });

  it("PLAYWRIGHT_BROWSERS_PATH を browsersPath にする（空は無視）", () => {
    expect(optionsFromEnv({ PLAYWRIGHT_BROWSERS_PATH: "/ms-playwright" })).toEqual({ browsersPath: "/ms-playwright" });
    expect(optionsFromEnv({ PLAYWRIGHT_BROWSERS_PATH: "" })).toEqual({});
  });

  it("まとめて読む", () => {
    expect(
      optionsFromEnv({
        CSRC_CHANNELS: "msedge",
        CSRC_DISABLE_CHANNELS: "1",
        CSRC_INSTALL_MODE: "custom",
        PLAYWRIGHT_BROWSERS_PATH: "/tmp/pw",
        UNRELATED: "x",
      }),
    ).toEqual({ channels: ["msedge"], disableChannels: true, installMode: "custom", browsersPath: "/tmp/pw" });
  });
});

describe("resolveOptions", () => {
  it("既定値を補う", () => {
    const r = resolveOptions({}, {});
    expect(r.channels).toEqual(["chrome", "msedge"]);
    expect(r.disableChannels).toBe(false);
    expect(r.installMode).toBe("auto");
    expect(r.headless).toBe(true);
    expect(r.launchTimeoutMs).toBe(60_000);
    expect(r.browsersPath).toBeUndefined();
    expect(typeof r.log).toBe("function");
  });

  it("browsersPath が無ければ PLAYWRIGHT_BROWSERS_PATH を使う（Playwright と同じ意味）", () => {
    expect(resolveOptions({}, { PLAYWRIGHT_BROWSERS_PATH: "/env/pw" }).browsersPath).toBe("/env/pw");
    expect(resolveOptions({ browsersPath: "/opt/pw" }, { PLAYWRIGHT_BROWSERS_PATH: "/env/pw" }).browsersPath).toBe("/opt/pw");
  });

  it("指定した値はそのまま使う", () => {
    const log = () => {};
    const r = resolveOptions(
      { channels: ["msedge"], disableChannels: true, installMode: "custom", headless: false, launchTimeoutMs: 5, log },
      {},
    );
    expect(r).toMatchObject({ channels: ["msedge"], disableChannels: true, installMode: "custom", headless: false, launchTimeoutMs: 5 });
    expect(r.log).toBe(log);
  });
});
