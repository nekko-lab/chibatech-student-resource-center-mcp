# @chibatech-src/parsers

千葉工業大学「学生資料室」ポータル（ログイン不要の静的サイト）で公開されている PDF のうち、
**バスダイヤ**と**学科長・専攻長・クラス担任表**について、座標付きテキストから表の構造を復元する純関数群です。

> **非公式**のツールです。千葉工業大学および学生資料室とは関係ありません。
> 内容の正しさは元の PDF で確認してください。

## 位置づけ

- PDF から座標付きテキストを取り出すのは `packages/pdf` の担当です。このパッケージは**抽出済みの座標データを受け取るだけ**です。
- 実行時の依存はありません。Node / Bun / 単一バイナリ（`bun build --compile`、Node SEA）のどれでも同じように動きます。
- 入力の型 `TextItem` / `PageItems` は `packages/pdf` と同じ形ですが、依存させずにこのパッケージ内でも定義しています。

```ts
interface TextItem { str: string; x: number; y: number; width: number; height: number }
interface PageItems { page: number; width: number; height: number; items: TextItem[] }
// x = transform[4], y = viewport 高さ - transform[5]（ページ上端からベースライン）, 単位は PDF user space（scale 1）
```

## API

```ts
import { parseBusSchedule, nextBuses, parseClassTeachers, findTeachers } from "@chibatech-src/parsers";

// バスダイヤ
const schedule = parseBusSchedule(pages);
nextBuses(schedule, { from: "津田沼", dayType: "weekday", now: "08:30" });
// → [{ time: "08:45" }, { time: "09:25", note: "茜40" }, ...]（既定 3 件）

// 担任表
const table = parseClassTeachers(pages);
findTeachers(table, { department: "情報工学科", year: 2 });
// → [{ faculty, department, head, years: [{ year: 2, teachers: [{ name: "姓 名", main: true }, ...] }] }]
```

### バスダイヤ

| 関数 | 説明 |
|---|---|
| `parseBusSchedule(pages)` | `BusSchedule` を返す。`directions` は時刻列の左・右の順、各方向の `columns` は時刻列に近い順 |
| `nextBuses(s, { from, dayType, now, count? })` | `now` 以降の発車を `count` 件（既定 3）。`now` ちょうども含む |

- `dayType` は `"weekday" | "saturday" | "holiday" | "special"`。曜日の語を含まない見出しの列（「１２月…日（…）」のような特定日）は `special` になり、見出しの文字列は `label` に入ります。
- `time` は `"HH:MM"` で、昇順に並びます。「（茜XX）」のような注記は、括弧を外して `note` に入ります。
- `from` は部分一致です（末尾の「駅」「発」「行」は無視します）。
- `now` の書式が不正なときは `RangeError` を投げます。
- 表の下の脚注と、読めなかった箇所は `notes` に入ります。読めなかった箇所は「読み取れなかった（場所）: …」で始まります。

### 担任表

| 関数 | 説明 |
|---|---|
| `parseClassTeachers(pages)` | `TeacherTable` を返す |
| `findTeachers(t, { department, year? })` | 学科（専攻）名で行を探す。完全一致があればそれだけ、なければ部分一致（NFKC・空白除去の後で照合） |

- 1 学科が複数行にまたがっていても 1 行（`rows` の 1 要素）になります。各年次には複数名が入り、主担任（◎）は `main: true` です。
- 氏名は「姓 名」（半角空白 1 つ）です。元が詰めて書かれている氏名はそのまま返します。
- 空欄の年次は `teachers: []` になります。
- 大学院の専攻長一覧も行として返します。`faculty` が研究科、`department` が専攻、`head` が専攻長（職名は除く）で、`years` は空です。`year` を指定すると、年次列を持たないこれらの行は除かれます。
- 指定の形に加えて、読めなかった箇所を返す省略可能な `notes?: string[]` があります。

## 復元の方法

- **列の境界は固定の数値を持ちません。** 見出し語（「平日」「時刻」「学科長」「１年次」など）の x 範囲を列の目印にし、隣り合う見出しの間で内容に覆われていない最も広い区間の中央を境界にします。年度ごとに列幅や位置が変わっても追従できます。
- **バスダイヤ:**
  - 「時刻」列を軸にして、左右を 2 つの方向（「〇〇発」「〇〇行」の見出し）として読みます。
  - 1 文字ずつ離して置かれた見出し（「土 曜」）や縦に積まれた見出し（日曜日 / 祝日 / 休日）は、x 範囲が重なるものどうしを 1 列にまとめます。
  - 分は最も近い「時」の行に割り当てます。注記は同じセルの中で x が最も近い分に結びつけます（2 片に割れた注記もつなぎます）。
- **担任表:**
  - 見出し行（学部ブロックごとに繰り返される）で区画を切ります。
  - 縦書きの学部名は、それが中央に来る連続した学科の行に割り当てます。
  - 各セルの氏名は、最も近い学科の行に割り当てます。
- 例外で握りつぶさず、読めなかった箇所は `notes` に返します。

## 開発

実行はすべて Docker の中で行います（ホストに node やパッケージを入れません）。

```sh
./scripts/test.sh   # ルートの scripts/test.sh packages/parsers を呼ぶ（Docker の中で tsc --noEmit と vitest run）
```

- テストの fixture は、実物と**同じ幾何構造を持つ合成データ**を生成器（`test/fixtures/*-generator.ts`）で作ります。架空の時刻・架空の氏名だけを使います。
- レイアウトの観察用に、開発用スクリプトがあります（devDependency の `pdfjs-dist` を使用）。
  - `scripts/dump-layout.mjs <in.pdf> [out.json]`: PDF から `PageItems[]` の JSON を出力します。
  - `node --experimental-strip-types scripts/summarize.ts bus|teachers <layout.json>`: parse 結果の件数などの要約だけを表示します。

### 公開リポジトリでの取り扱い

実際の PDF、抽出結果、時刻、教員の氏名はリポジトリに含めません。観察用に取得した PDF や JSON は
gitignore 済みの `.research/` などに置き、コミットしないでください。
