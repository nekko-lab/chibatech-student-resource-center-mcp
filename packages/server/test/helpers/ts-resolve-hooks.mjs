// 子プロセス（node の型除去で .ts を直接実行する）用の解決フック。
// ワークスペースの一部は拡張子なしの相対 import（bundler 解決）を使うので、見つからなければ `.ts` を補う。
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (e) {
      if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[cm]?[jt]s$/.test(specifier)) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw e;
    }
  },
});
