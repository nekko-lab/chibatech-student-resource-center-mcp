import { describe, expect, it } from "vitest";
import {
  HostThrottle,
  MemoryPdfCache,
  PdfFetchError,
  fetchPdf,
  type Fetcher,
} from "../src/index.ts";

const URL_A = "https://portal.example.test/portal/common_2026/life.pdf";
const URL_B = "https://portal.example.test/portal/common_2026/rule.pdf";
const OTHER_HOST = "https://other.example.test/x.pdf";
const UA = "chibatech-src-mcp-test/0.0";

const enc = (s: string) => new TextEncoder().encode(s);
const pdfBody = (tag: string) => enc(`%PDF-1.7\n% ${tag}\n%%EOF\n`);

interface Call {
  url: string;
  headers: Record<string, string>;
}
type Reply = { status: number; headers?: Record<string, string>; body?: Uint8Array };

/** 受けた要求を記録し、用意した応答を順に返すフェイクの fetcher。 */
function fakeFetcher(...replies: Reply[]): Fetcher & { calls: Call[] } {
  const calls: Call[] = [];
  const f = (async (url, headers) => {
    calls.push({ url, headers: { ...headers } });
    const r = replies.shift();
    if (!r) throw new Error("unexpected request");
    return { status: r.status, headers: r.headers ?? {}, body: r.body ?? new Uint8Array() };
  }) as Fetcher & { calls: Call[] };
  f.calls = calls;
  return f;
}

/** 手で進める時計。sleep は時計を進めるだけで実際には待たない。 */
function fakeClock(start = 1_000_000) {
  let t = start;
  const sleeps: number[] = [];
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
    sleeps,
  };
}

function baseOpts(fetcher: Fetcher, clock = fakeClock()) {
  return {
    fetcher,
    cache: new MemoryPdfCache(),
    userAgent: UA,
    now: clock.now,
    sleep: clock.sleep,
    throttle: new HostThrottle(),
  };
}

describe("fetchPdf", () => {
  it("初回は条件なしで GET し、本体をキャッシュに保存する", async () => {
    const fetcher = fakeFetcher({
      status: 200,
      headers: { "Last-Modified": "Wed, 10 Jun 2026 01:02:03 GMT", ETag: '"v1"' },
      body: pdfBody("v1"),
    });
    const opts = baseOpts(fetcher);
    const r = await fetchPdf(URL_A, opts);

    expect(r.fromCache).toBe(false);
    expect(r.lastModified).toBe("Wed, 10 Jun 2026 01:02:03 GMT");
    expect(new TextDecoder().decode(r.bytes)).toContain("v1");
    expect(fetcher.calls).toHaveLength(1);
    const sent = lower(fetcher.calls[0]!.headers);
    expect(sent["user-agent"]).toBe(UA);
    expect(sent["if-modified-since"]).toBeUndefined();
    expect(sent["if-none-match"]).toBeUndefined();

    const cached = await opts.cache.get(URL_A);
    expect(cached?.etag).toBe('"v1"');
    expect(cached?.lastModified).toBe("Wed, 10 Jun 2026 01:02:03 GMT");
    expect(cached?.fetchedAt).toBe(opts.now());
  });

  it("2 回目は If-Modified-Since / If-None-Match を付け、304 ならキャッシュを返す", async () => {
    const clock = fakeClock();
    const fetcher = fakeFetcher(
      { status: 200, headers: { "last-modified": "Wed, 10 Jun 2026 01:02:03 GMT", etag: '"v1"' }, body: pdfBody("v1") },
      { status: 304, headers: {} },
    );
    const opts = baseOpts(fetcher, clock);
    await fetchPdf(URL_A, opts);
    clock.advance(60_000);
    const r = await fetchPdf(URL_A, opts);

    expect(r.fromCache).toBe(true);
    expect(r.lastModified).toBe("Wed, 10 Jun 2026 01:02:03 GMT");
    expect(new TextDecoder().decode(r.bytes)).toContain("v1");
    const sent = lower(fetcher.calls[1]!.headers);
    expect(sent["if-modified-since"]).toBe("Wed, 10 Jun 2026 01:02:03 GMT");
    expect(sent["if-none-match"]).toBe('"v1"');
    expect(sent["user-agent"]).toBe(UA);
    // 再検証した時刻を記録する
    expect((await opts.cache.get(URL_A))?.fetchedAt).toBe(clock.now());
  });

  it("更新されていれば 200 の新しい本体でキャッシュを置き換える", async () => {
    const fetcher = fakeFetcher(
      { status: 200, headers: { etag: '"v1"' }, body: pdfBody("v1") },
      { status: 200, headers: { etag: '"v2"', "last-modified": "Thu, 11 Jun 2026 00:00:00 GMT" }, body: pdfBody("v2") },
    );
    const opts = baseOpts(fetcher);
    await fetchPdf(URL_A, opts);
    const r = await fetchPdf(URL_A, opts);
    expect(r.fromCache).toBe(false);
    expect(new TextDecoder().decode(r.bytes)).toContain("v2");
    expect((await opts.cache.get(URL_A))?.etag).toBe('"v2"');
  });

  it("URL の fragment（#page=N）は要求にもキャッシュキーにも含めない", async () => {
    const fetcher = fakeFetcher({ status: 200, body: pdfBody("x") }, { status: 304 });
    const opts = baseOpts(fetcher);
    await fetchPdf(`${URL_A}#page=13`, opts);
    const r = await fetchPdf(`${URL_A}#page=20`, opts);
    expect(fetcher.calls.map((c) => c.url)).toEqual([URL_A, URL_A]);
    expect(r.fromCache).toBe(true);
    expect(await opts.cache.get(URL_A)).toBeDefined();
  });

  it("クエリ（版を表す ?20260611_01 など）は別の資源として扱う", async () => {
    const fetcher = fakeFetcher({ status: 200, body: pdfBody("q1") }, { status: 200, body: pdfBody("q2") });
    const opts = baseOpts(fetcher);
    await fetchPdf(`${URL_A}?20260611_01`, opts);
    await fetchPdf(`${URL_A}?20260612_01`, opts);
    expect(lower(fetcher.calls[1]!.headers)["if-none-match"]).toBeUndefined();
  });

  it("エラー応答は PdfFetchError（status 付き）で、キャッシュは変えない", async () => {
    const fetcher = fakeFetcher({ status: 200, headers: { etag: '"v1"' }, body: pdfBody("v1") }, { status: 404 });
    const opts = baseOpts(fetcher);
    await fetchPdf(URL_A, opts);
    const err = await fetchPdf(URL_A, opts).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PdfFetchError);
    expect((err as PdfFetchError).status).toBe(404);
    expect((err as PdfFetchError).url).toBe(URL_A);
    expect((await opts.cache.get(URL_A))?.etag).toBe('"v1"');
  });

  it("キャッシュが無いのに 304 が返ったらエラー", async () => {
    const fetcher = fakeFetcher({ status: 304 });
    await expect(fetchPdf(URL_A, baseOpts(fetcher))).rejects.toBeInstanceOf(PdfFetchError);
  });

  it("200 でも本体が PDF でなければ（HTML のエラーページなど）エラーにして保存しない", async () => {
    const fetcher = fakeFetcher({ status: 200, body: enc("<!doctype html><title>Not Found</title>") });
    const opts = baseOpts(fetcher);
    await expect(fetchPdf(URL_A, opts)).rejects.toBeInstanceOf(PdfFetchError);
    expect(await opts.cache.get(URL_A)).toBeUndefined();
  });

  it("先頭に少しゴミがあっても %PDF- が冒頭 1KB 内にあれば PDF とみなす", async () => {
    const fetcher = fakeFetcher({ status: 200, body: enc("\r\n\r\n%PDF-1.4\n%%EOF") });
    const r = await fetchPdf(URL_A, baseOpts(fetcher));
    expect(r.fromCache).toBe(false);
  });

  describe("同一ホストへの間隔", () => {
    it("同じホストへの連続要求は minIntervalMs 以上空ける", async () => {
      const clock = fakeClock();
      const fetcher = fakeFetcher({ status: 200, body: pdfBody("a") }, { status: 200, body: pdfBody("b") });
      const opts = { ...baseOpts(fetcher, clock), minIntervalMs: 1500 };
      await fetchPdf(URL_A, opts);
      clock.advance(400);
      await fetchPdf(URL_B, opts);
      expect(clock.sleeps).toEqual([1100]);
    });

    it("既定の間隔は 1000ms", async () => {
      const clock = fakeClock();
      const fetcher = fakeFetcher({ status: 200, body: pdfBody("a") }, { status: 200, body: pdfBody("b") });
      const opts = baseOpts(fetcher, clock);
      await fetchPdf(URL_A, opts);
      await fetchPdf(URL_B, opts);
      expect(clock.sleeps).toEqual([1000]);
    });

    it("十分に時間が経っていれば待たない", async () => {
      const clock = fakeClock();
      const fetcher = fakeFetcher({ status: 200, body: pdfBody("a") }, { status: 200, body: pdfBody("b") });
      const opts = baseOpts(fetcher, clock);
      await fetchPdf(URL_A, opts);
      clock.advance(1000);
      await fetchPdf(URL_B, opts);
      expect(clock.sleeps).toEqual([]);
    });

    it("別のホストには待たずに要求する", async () => {
      const clock = fakeClock();
      const fetcher = fakeFetcher({ status: 200, body: pdfBody("a") }, { status: 200, body: pdfBody("b") });
      const opts = baseOpts(fetcher, clock);
      await fetchPdf(URL_A, opts);
      await fetchPdf(OTHER_HOST, opts);
      expect(clock.sleeps).toEqual([]);
    });

    it("同時に投げた要求も順番に間隔を空ける", async () => {
      const clock = fakeClock();
      const fetcher = fakeFetcher(
        { status: 200, body: pdfBody("a") },
        { status: 200, body: pdfBody("b") },
        { status: 200, body: pdfBody("c") },
      );
      // sleep は時計を進めない（同時に待つ状況を再現）
      const sleeps: number[] = [];
      const opts = { ...baseOpts(fetcher, clock), sleep: async (ms: number) => void sleeps.push(ms) };
      await Promise.all([fetchPdf(URL_A, opts), fetchPdf(URL_B, opts), fetchPdf(`${URL_A}?v=2`, opts)]);
      expect(sleeps.sort((a, b) => a - b)).toEqual([1000, 2000]);
    });

    it("要求が失敗しても間隔の記録は残る", async () => {
      const clock = fakeClock();
      const fetcher = fakeFetcher({ status: 500 }, { status: 200, body: pdfBody("b") });
      const opts = baseOpts(fetcher, clock);
      await expect(fetchPdf(URL_A, opts)).rejects.toThrow();
      await fetchPdf(URL_B, opts);
      expect(clock.sleeps).toEqual([1000]);
    });
  });
});

function lower(h: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]));
}
