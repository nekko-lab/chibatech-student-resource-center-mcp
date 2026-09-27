/** 学科・専攻の選択肢。name は「コード：名称」の生文字列でも名称だけでもよい。 */
export interface DeptOption {
  code: string;
  name: string;
}

/** 照合候補。score は 0〜1（大きいほど確か）、候補の配列は score の降順。 */
export interface Candidate<T> {
  item: T;
  score: number;
  /** なぜ当たったか（人が読む短い説明） */
  reason: string;
}

export type StudentType = "undergrad" | "graduate";
