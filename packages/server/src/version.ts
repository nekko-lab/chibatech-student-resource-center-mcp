/** サーバの版。package.json の version と揃える（テストで照合している） */
export const VERSION = "0.1.0";

export const SERVER_NAME = "chibatech-src-mcp";

export const REPO_URL = "https://github.com/nekko-lab/chibatech-student-resource-center-mcp";

/** サイトへ送る User-Agent。ツール名・版・連絡先を載せ、非公式であることも示す */
export const USER_AGENT = `${SERVER_NAME}/${VERSION} (unofficial; +${REPO_URL})`;
