/**
 * 応答の約束（全ツール共通）。
 *
 * - 結果には出典（資料名・URL・ページ番号・Last-Modified）を付ける
 * - セッションで最初の応答に 1 回だけ、非公式である旨の注記を付ける
 * - LAYOUT_CHANGED は推測で補わず、その旨を返す
 * - エラーは code と details を読める形で返す
 * - 曖昧なときは候補を返して聞き返す（needs_clarification。エラーではない）
 * - 途中までの結果は partial（search_documents の索引作りが時間の上限に達したとき。エラーではない）
 */
import { PdfFetchError } from "@chibatech-src/pdf";
import { PortalError } from "@chibatech-src/portal";

export const NOTICE =
  "【注記】このツールは非公式です。千葉工業大学の公式情報ではありません。" +
  "正式な手続きや最新の内容は、必ず原本（学生資料室に掲載された資料）で確認してください。";

export const LAYOUT_CHANGED_HINT =
  "サイトの構造が変わった可能性があります。推測で補わずに処理を止めました。" +
  "学生資料室の原本を直接確認してください（ツールの更新が必要です）。";

/** 出典。値が分からない項目は null にする（省略しない） */
export interface Source {
  /** 資料名（ページの見出し・リンク名・PDF のファイル名） */
  title: string | null;
  url: string;
  /** 本文を返したページ番号（PDF のとき） */
  pages?: number[];
  /** サーバが返した Last-Modified。送られなかったときは null */
  lastModified: string | null;
}

export type Outcome =
  | { status: "ok"; data: Record<string, unknown>; sources: Source[] }
  | { status: "partial"; data: Record<string, unknown>; sources: Source[] }
  | { status: "needs_clarification"; question: string; candidates: unknown[]; data?: Record<string, unknown>; sources: Source[] };

export function ok(data: Record<string, unknown>, sources: Source[]): Outcome {
  return { status: "ok", data, sources };
}

/** 途中までの結果（続きは同じ呼び出しを繰り返すと得られる） */
export function partial(data: Record<string, unknown>, sources: Source[]): Outcome {
  return { status: "partial", data, sources };
}

export function clarify(question: string, candidates: unknown[], sources: Source[], data?: Record<string, unknown>): Outcome {
  return data === undefined
    ? { status: "needs_clarification", question, candidates, sources }
    : { status: "needs_clarification", question, candidates, data, sources };
}

export interface ToolResponse {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export interface ErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export function describeError(e: unknown): ErrorBody {
  if (e instanceof PortalError) {
    return e.details === undefined ? { code: e.code, message: e.message } : { code: e.code, message: e.message, details: e.details };
  }
  if (e instanceof PdfFetchError) {
    return { code: "FETCH", message: e.message, details: { url: e.url, status: e.status ?? null } };
  }
  if (e instanceof Error) return { code: "INTERNAL", message: e.message };
  return { code: "INTERNAL", message: String(e) };
}

/** 1 セッション（1 つの createServer）に 1 つ。注記を最初の応答にだけ付ける */
export class Responder {
  #noticed = false;

  #wrap(body: Record<string, unknown>, isError: boolean): ToolResponse {
    const content: ToolResponse["content"] = [];
    if (!this.#noticed) {
      this.#noticed = true;
      content.push({ type: "text", text: NOTICE });
    }
    content.push({ type: "text", text: JSON.stringify(body, null, 2) });
    return isError ? { content, isError: true } : { content };
  }

  success(o: Outcome): ToolResponse {
    if (o.status === "ok" || o.status === "partial") return this.#wrap({ status: o.status, ...o.data, sources: o.sources }, false);
    const body: Record<string, unknown> = { status: o.status, question: o.question, candidates: o.candidates };
    if (o.data) Object.assign(body, o.data);
    body.sources = o.sources;
    return this.#wrap(body, false);
  }

  failure(e: unknown): ToolResponse {
    const error = describeError(e);
    const body: Record<string, unknown> = { status: "error", error };
    if (error.code === "LAYOUT_CHANGED") body.hint = LAYOUT_CHANGED_HINT;
    return this.#wrap(body, true);
  }
}
