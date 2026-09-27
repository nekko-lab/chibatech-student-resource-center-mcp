/**
 * 単一バイナリの入口。
 *
 * 1. bun compile の中では「import.meta.url と process.argv[1] の比較」が予期せず真になり
 *    main() が二重に走る既知の問題がある（参照実装で確認済み）。argv[1] を潰したうえで
 *    ここから明示的に main() を 1 回だけ呼ぶ形に固定する。
 *
 * 2. playwright-core の registry.install() は `child_process.fork(<lib>/entry/oopBrowserDownload.js)`
 *    でダウンロード用の子を起こす。単一バイナリでは fork が「このバイナリ自身」を起動するため、
 *    何もしないと子が MCP サーバとして立ち上がり、親は永久に待つ（コンテナで実測）。
 *    argv に oopBrowserDownload.js が来たら、サーバではなく Playwright のダウンロード処理を動かす。
 */
// CSRC_DISABLE_OOP_DISPATCH=1 はこの回避策を切る検証用（registry 経路が失敗して custom に落ちることを確かめる）。
const isOopDownloadChild =
  process.env.CSRC_DISABLE_OOP_DISPATCH !== '1' && process.argv.some((a) => /oopBrowserDownload\.js$/.test(a));

if (isOopDownloadChild) {
  const core = (await import('playwright-core/lib/coreBundle')) as any;
  core.registry.runOopDownloadBrowserMain();
} else if (typeof process.send === 'function' && process.env.CSRC_ALLOW_IPC !== '1') {
  // Bun の fork は NODE_CHANNEL_FD を立てないため（実測）、IPC の有無は process.send で判定する。
  // 想定外の fork（IPC 付き起動）でサーバが立ち上がって親を待たせ続けないようにする。
  process.stderr.write(`[csrc-poc] 想定外の fork 起動のため終了します: ${JSON.stringify(process.argv.slice(1))}\n`);
  process.exit(3);
} else {
  process.argv[1] = 'csrc-poc-launcher';
  const mod = await import('./server.ts');
  await mod.main();
}
