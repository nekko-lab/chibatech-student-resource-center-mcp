import { describe, expect, it } from "vitest";

describe("@chibatech-src/browser", () => {
  it("公開 API を export する（packages/server と tools/build が使う名前）", async () => {
    const mod = await import("../src/index.ts");
    for (const name of [
      "acquireBrowser",
      "optionsFromEnv",
      "detectLaunchRole",
      "runLauncher",
      "customDownloadUrl",
      "BrowserUnavailableError",
    ] as const) {
      expect(mod[name], name).toBeTypeOf("function");
    }
  });

  it("playwright-core を解決できる", async () => {
    const pw = await import("playwright-core");
    expect(pw.chromium).toBeDefined();
  });
});
