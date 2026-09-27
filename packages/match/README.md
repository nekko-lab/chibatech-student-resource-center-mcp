# @chibatech-src/match

学生の自然な日本語の質問（「2024年入学の情工の進級要件」「奨学金について」）を、千葉工業大学「学生資料室」ポータルの選択肢や資料のタイトルに対応づける純関数群です。
大学公式のパッケージではありません（非公式）。

- 実行時依存はありません。Node 専用・Bun 専用の API も使っていません（`bun build --compile` でも Node SEA でも動きます）。
- どの関数も純関数です。同じ入力には同じ出力を返し、I/O をしません。
- 略称辞書と同義語辞書はコードと分けて `src/data/` に置いてあり、後から足しやすくしています。

## 使い方

```ts
import {
  normalizeJa,
  parseDeptOption,
  resolveDepartment,
  searchByKeyword,
  resolveYear,
  resolveStudentType,
} from "@chibatech-src/match";

const options = ["G1：情報工学科（2024年度入学～）", "31：情報工学科（～2023年度入学）"].map(parseDeptOption);

resolveDepartment("2024年入学の情工", options).best; // { code: "G1", name: "情報工学科（2024年度入学～）" }
resolveDepartment("情工", options).ambiguous;        // true（年度でコードが違う同じ学科なので、学生に聞き返す）

searchByKeyword("奨学金", ["奨学制度について", "履修登録の手引き"], (t) => t);
// [{ item: "奨学制度について", score: 0.7…, reason: "同義語「奨学制度」" }]

resolveYear("R6", new Date());              // 2024
resolveYear("去年", new Date(2026, 1, 10)); // 2024（1〜3 月は前年度として数える）
resolveStudentType("M1");                   // "graduate"
```

## API

### `normalizeJa(s: string): string`

照合用のキーを作ります。表示には使いません。

1. NFKC（全角の英数字・記号は半角に、半角カタカナは全角に）
2. 英字を小文字に
3. カタカナをひらがなに
4. 長音・ハイフン・ダッシュ・マイナス（`ー ‐ – — ― − －` など）は `-` に、波ダッシュ・チルダ（`〜 ～ ~` など）は `~` にそろえる
5. 空白をすべて除く

冪等です（`normalizeJa(normalizeJa(s)) === normalizeJa(s)`）。

### `parseDeptOption(raw: string): DeptOption`

`コード：名称` の文字列を分けます。コロンは全角・半角のどちらでも受け、コードは半角大文字にそろえます。
コードが無ければ `{ code: "", name }` を返します。

### `resolveDepartment(query, options)`

```ts
resolveDepartment(query: string, options: DeptOption[]):
  { best?: DeptOption; candidates: Candidate<DeptOption>[]; ambiguous: boolean }
```

- `options[].name` は `コード：名称` の生文字列でも、名称だけでもかまいません。
- `candidates[].item` と `best` は、**渡された要素そのもの**です（複製ではありません）。コードが要るときは `best.code` を読むか、`parseDeptOption(best.name)` を呼びます。
- 採点（0〜1、高い順）:

  | 条件 | score |
  |---|---|
  | コードが完全一致（`G1` `g1` `Ｇ１`） | 1.00 |
  | 名称が完全一致 | 0.97 |
  | 略称が完全一致（`情工` `PM` など） | 0.95 |
  | 質問文が名称を含む（`建築学科の卒業要件`） | 0.90 |
  | 質問文が略称を含む（`2024年入学の情工`） | 0.85 |
  | 名称が質問文を含む（部分一致） | 0.55 + 0.35 × 質問文の長さ / 名称の長さ |
  | 2-gram の一部が共通（Dice ≥ 0.3） | 0.7 × Dice |

  - 質問文の中に見つかった略称は、最も長いものだけを数えます。質問文そのものがどれかの選択肢の名称に含まれるときは、略称による判定は使いません。
- **括弧内の注記**
  - `（2024年度入学～）` のような年度の注記は、名称の照合から外します。
  - 年度の注記を使うのは、質問文に年度（4 桁、2 桁＋年、令和・平成、R・H）が含まれるときだけです。年度が範囲内なら +0.05、範囲外なら −0.2 します。
  - `（修士課程）` のような年度以外の注記は、注記そのものか先頭 2 文字（`修士`）が質問文にあれば +0.05 します。
- **曖昧さ**: 上位 2 件の差が 0.03 以下のときは `ambiguous: true` にし、`best` は undefined にします。呼び出し側は `candidates` を使って学生に聞き返してください。
- score が 0.2 未満の候補は捨てます。一致が無ければ `{ candidates: [], ambiguous: false }` を返します。
- 「今年」「去年」のような相対的な年は読みません（日付の引数が無いため）。先に `resolveYear` で変換してください。

### `searchByKeyword(query, items, getText, opts?)`

```ts
searchByKeyword<T>(query: string, items: T[], getText: (t: T) => string,
  opts?: { limit?: number; minScore?: number }): Candidate<T>[]
```

- 空白（半角・全角）で区切った語は **AND** で組み合わせます。
- 語ごとに、本文から次のものを探します。

  | 見つかったもの | 重み |
  |---|---|
  | 語そのもの、または末尾の「について」などを除いた語 | 1.00 |
  | 語に含まれる辞書の語（「給付型奨学金」の中の「奨学金」） | 0.80 |
  | 同義語 | 0.75 |
  | 語に含まれる辞書の語の同義語 | 0.65 |
  | 3 文字以上の語の弱い 2-gram 一致（共通率 ≥ 0.6） | 0.5 × 共通率 |

- 最終の score = 語の重みの平均 × (0.9 + 0.1 × 一致した語が本文を占める割合)。同じ強さの一致なら、短いタイトルが上に来ます。
- 既定値は `limit` = 20、`minScore` = 0。同点は入力順を保ちます。

### `resolveYear(input: string, today: Date): number | undefined`

| 入力 | 結果 |
|---|---|
| `2024` `２０２４` `2024年度入学` | 2024 |
| `24` `24年` `24年度` | 2000 + n |
| `R6` `令和6年` `令和元年` | 2018 + n |
| `H28` `平成28年度` | 1988 + n |
| `今年` `今年度` `本年度` | 今の年度 |
| `去年` `昨年` `昨年度` `前年度` | 前の年度 |
| `一昨年` `おととし` | 2 年度前 |
| `来年` `来年度` `翌年度` | 次の年度 |

- 年度は 4 月始まりで、1〜3 月は前年度に属します。`today` はローカル時刻（`getFullYear` / `getMonth`）で読みます。
- 年として読めない入力（`1年生` `B2` `123`）は `undefined` を返します。範囲（2016〜2026 など）は確かめないので、呼び出し側で確かめてください。

### `resolveStudentType(input: string): "undergrad" | "graduate" | undefined`

- undergrad: 学部、学部生、学士、B1〜B6、undergrad(uate)、bachelor、ポータルの値 `1`（入力がちょうど `1` のときだけ）
- graduate: 大学院、院、院生、修士、博士、前期課程、後期課程、マスター、ドクター、M1、M2、D1〜D3、graduate、master、doctor、ポータルの値 `2`
- 両方の手がかりがある入力（`学部と大学院`）と、どちらも無い入力には `undefined` を返します。

## 辞書に語を足すとき

| ファイル | 中身 |
|---|---|
| `src/data/departmentAliases.ts` | 略称 → 学科・専攻の名称（括弧の注記は付けない） |
| `src/data/synonyms.ts` | 同義語のグループ（双方向）と、語の末尾から取り除く言い回し |
| `src/data/studentTypeTerms.ts` | 区分を決める語 |

- どの語も照合の前に `normalizeJa` を通すので、カタカナとひらがな、全角と半角の揺れを別々に書く必要はありません。
- 語を足したら、`test/department.test.ts` か `test/keyword.test.ts` に 1 件ずつテストを足してください。
- `test/data.test.ts` が、空の語・重複・括弧を含む名称を検査します。
- このリポジトリは公開されています。ポータルの学科表や URL を丸ごと写さず、学生が実際に使う名称だけを載せてください。

## テスト

すべて Docker の中で実行します。ホストに node やパッケージを入れないでください。

```sh
packages/match/scripts/test.sh   # ルートの scripts/test.sh packages/match を呼ぶ（Docker の中で tsc --noEmit と vitest run）
```

依存を足すときは、ルートの `docs/development.md` の「依存の追加と lockfile の更新」に従ってください（lockfile はルートの 1 つだけです）。
