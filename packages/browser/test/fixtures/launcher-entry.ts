// launcher.test.ts が子プロセスとして起動する入口（node の型の除去で .ts のまま実行する）。
// 単一バイナリの入口と同じく、main は runLauncher からだけ呼ぶ。
import { runLauncher } from "../../src/index.ts";

await runLauncher(async () => {
  process.stderr.write("MAIN_RAN\n");
});
