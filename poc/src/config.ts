/**
 * PoC 全体で共有する定数。
 *
 * 非公式ツール。対象サイト（千葉工業大学 学生資料室）への負荷を抑えるため、
 * User-Agent にツール名と連絡先（リポジトリ URL）を必ず載せる。
 */
export const TOOL_NAME = 'chibatech-src-mcp-poc';
export const TOOL_VERSION = '0.0.0';
export const REPO_URL = 'https://github.com/nekko-lab/chibatech-student-resource-center-mcp';

export const PORTAL_BASE_URL = 'https://kmsk.is.it-chiba.ac.jp/portal/';

/** サイトへ送る User-Agent。非公式であることも明示する。 */
export const USER_AGENT = `${TOOL_NAME}/${TOOL_VERSION} (unofficial; +${REPO_URL})`;

/** 幅 737px 未満でスマホ版レイアウト（アコーディオンが閉じる）になるため固定する。 */
export const VIEWPORT = { width: 1024, height: 768 } as const;

/** 解析系の要求は止める。 */
export const BLOCKED_HOST_PATTERNS = [/(^|\.)googletagmanager\.com$/, /(^|\.)google-analytics\.com$/];

/** 環境変数: 1 なら channel（chrome / msedge）を試さず、ダウンロード経路に直行する。 */
export const ENV_DISABLE_CHANNELS = 'CSRC_DISABLE_CHANNELS';
/** 環境変数: ダウンロード方式。auto（既定）/ registry / custom。 */
export const ENV_INSTALL_MODE = 'CSRC_INSTALL_MODE';
/** 環境変数: 試す channel の並び（既定 "chrome,msedge"）。 */
export const ENV_CHANNELS = 'CSRC_CHANNELS';
