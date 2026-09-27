import { resolveStudentType, resolveYear } from "@chibatech-src/match";
import type { ServerDeps, StudentProfile } from "./types.ts";

export type EnvDeps = Omit<ServerDeps, "getBrowser" | "userAgent">;

/** mcpb が未入力の user_config を置換せずに渡したときの形（`${user_config.x}`） */
const UNSET_PLACEHOLDER = /^\$\{[^}]*\}$/;

function read(env: Record<string, string | undefined>, key: string): string | undefined {
  const v = env[key]?.trim();
  if (!v || UNSET_PLACEHOLDER.test(v)) return undefined;
  return v;
}

/**
 * 環境変数から既定値を読む。mcpb の user_config はこの環境変数に写される。
 *
 * - `CSRC_STUDENT_TYPE`: undergrad | graduate（「学部生」「院生」など日本語も可）
 * - `CSRC_ADMISSION_YEAR`: 入学年度（2024、R6 なども可）
 * - `CSRC_DEPARTMENT`: 学科・専攻のコードか名称
 * - `CSRC_DOWNLOAD_DIR`: document_download の保存先
 * - `CSRC_CACHE_DIR`: PDF キャッシュの置き場所
 *
 * 読めない値は捨てて `warn` に理由を渡す（起動は止めない）。
 */
export function depsFromEnv(
  env: Record<string, string | undefined>,
  warn: (message: string) => void = () => undefined,
  today: Date = new Date(),
): EnvDeps {
  const out: EnvDeps = {};
  const profile: StudentProfile = {};

  const type = read(env, "CSRC_STUDENT_TYPE");
  if (type !== undefined) {
    const t = resolveStudentType(type);
    if (t) profile.studentType = t;
    else warn(`CSRC_STUDENT_TYPE を区分として読めないため無視します: ${type}`);
  }

  const year = read(env, "CSRC_ADMISSION_YEAR");
  if (year !== undefined) {
    const y = resolveYear(year, today);
    if (y !== undefined && y >= 1900 && y <= 2999) profile.admissionYear = y;
    else warn(`CSRC_ADMISSION_YEAR を入学年度として読めないため無視します: ${year}`);
  }

  const dept = read(env, "CSRC_DEPARTMENT");
  if (dept !== undefined) profile.department = dept;

  if (Object.keys(profile).length > 0) out.profile = profile;

  const downloadDir = read(env, "CSRC_DOWNLOAD_DIR");
  if (downloadDir !== undefined) out.downloadDir = downloadDir;
  const cacheDir = read(env, "CSRC_CACHE_DIR");
  if (cacheDir !== undefined) out.cacheDir = cacheDir;
  return out;
}
