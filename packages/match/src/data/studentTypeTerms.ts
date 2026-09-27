/**
 * 学生区分の判定語。照合時に normalizeJa を通した文字列に対して部分一致で調べる。
 * ポータルの区分の値（学部生 = "1"、大学院生 = "2"）は入力全体が一致したときだけ使う。
 */
export const UNDERGRAD_TERMS: readonly string[] = ["学部", "学士", "undergrad", "bachelor"];

export const GRADUATE_TERMS: readonly string[] = [
  "大学院",
  "院生",
  "院",
  "修士",
  "博士",
  "前期課程",
  "後期課程",
  "マスター",
  "ドクター",
  "graduate",
  "master",
  "doctor",
];

/** B1〜B6（学部の学年表記） */
export const UNDERGRAD_GRADE = /(?:^|[^a-z])b[1-6](?![0-9a-z])/;
/** M1・M2・D1〜D3（大学院の学年表記） */
export const GRADUATE_GRADE = /(?:^|[^a-z])(?:m[12]|d[1-3])(?![0-9a-z])/;

export const PORTAL_VALUE_UNDERGRAD = "1";
export const PORTAL_VALUE_GRADUATE = "2";
