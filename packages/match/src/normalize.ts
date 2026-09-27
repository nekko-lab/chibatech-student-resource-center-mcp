/**
 * 照合用の正規化。表示には使わない（比較キーを作るためだけのもの）。
 *
 * 1. NFKC（全角英数・全角記号→半角、半角カナ→全角カナ、全角空白→半角空白）
 * 2. 英字を小文字に
 * 3. カタカナ→ひらがな（長音「ー」は 4. で扱う）
 * 4. 長音・ハイフン・ダッシュ・マイナスの類を "-" に、波ダッシュの類を "~" に統一
 * 5. 空白を除去
 */

// 長音・ハイフン・ダッシュ・マイナス・罫線の類（NFKC 後に残りうるもの）
const DASH_LIKE = /[-‐-―−─━ーｰ﹣－]/g;
// 波ダッシュ・チルダの類
const WAVE_LIKE = /[~〜〰∼∾～]/g;
const SPACES = /\s+/g;
// ァ(30A1)〜ヶ(30F6) のうち、ひらがなに対応がある範囲 ァ〜ヶ → ぁ〜ゖ（0x60 引く）
const KATAKANA = /[ァ-ヶ]/g;

export function normalizeJa(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(KATAKANA, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(DASH_LIKE, "-")
    .replace(WAVE_LIKE, "~")
    .replace(SPACES, "");
}
