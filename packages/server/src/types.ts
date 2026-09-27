import type { Fetcher } from "@chibatech-src/pdf";
import type { Browser } from "playwright-core";

/** 学生の既定プロフィール。ツールの引数が優先する */
export interface StudentProfile {
  studentType?: "undergrad" | "graduate";
  admissionYear?: number;
  /** 学科・専攻のコード（例: G1）か名称 */
  department?: string;
}

export interface ServerDeps {
  /** 初回のツール呼び出しで 1 回だけ呼ぶ（遅延起動）。失敗したら次の呼び出しで呼び直す */
  getBrowser: () => Promise<{ browser: Browser; via: string }>;
  userAgent: string;
  /** PDF キャッシュの置き場所。未指定ならメモリ */
  cacheDir?: string;
  /** document_download の保存先 */
  downloadDir?: string;
  /** 学生の既定プロフィール（ツール引数が優先） */
  profile?: StudentProfile;
  /** 既定は portal の DEFAULT_BASE_URL */
  baseUrl?: string;
  now?: () => Date;
  /** 既定は stderr */
  log?: (message: string) => void;
  /**
   * PDF・文書の取得の差し替え口（テスト用）。既定はブラウザのコンテキストの `context.request` を包んだもの。
   * Playwright の route は `context.request` を横取りしないため、合成サイトでのテストではこれを渡す。
   */
  fetcher?: Fetcher;
}
