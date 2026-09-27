import { describe, expect, it } from "vitest";
import { findContact, findManual, getAbsenceForm } from "../src/macros/documents.ts";
import type { Outcome } from "../src/respond.ts";
import { BASE, LM, fakeEnv } from "./helpers/ports.ts";

function okData(o: Outcome): Record<string, unknown> {
  if (o.status !== "ok") throw new Error(`ok ではない: ${JSON.stringify(o)}`);
  return o.data;
}

describe("findManual", () => {
  it("キーワードに当たる文書の URL と要ログインかを返す", async () => {
    const { env } = fakeEnv();
    const o = await findManual(env, { keyword: "保険" });
    const d = okData(o);
    expect(d.matches).toEqual([
      { title: "架空の保険のしおり", category: "架空の学生生活", url: `${BASE}whole/web_manual/b.pdf`, ext: "pdf", requiresLogin: false },
    ]);
    expect(o.sources).toEqual([{ title: "申請様式・操作手引き", url: `${BASE}whole/web_manual.html`, lastModified: null }]);
  });

  it("要ログインの文書はその旨と注記を返す", async () => {
    const d = okData(await findManual(fakeEnv().env, { keyword: "VPN" }));
    expect(d.matches).toEqual([
      {
        title: "架空の VPN 接続",
        category: "架空のネットワーク",
        url: "https://drive.example.com/vpn",
        requiresLogin: true,
        note: "※学生専用/ログインしてください",
      },
    ]);
  });

  it("当たらなければ分類と文書名の一覧を返して聞き返す", async () => {
    const o = await findManual(fakeEnv().env, { keyword: "宇宙旅行" });
    expect(o.status).toBe("needs_clarification");
    if (o.status !== "needs_clarification") return;
    expect(o.candidates).toEqual([
      { category: "架空の学生生活", titles: ["架空の学びの手引き", "架空の保険のしおり"] },
      { category: "架空のネットワーク", titles: ["架空の VPN 接続"] },
    ]);
  });
});

describe("getAbsenceForm", () => {
  it("区分に合う様式の URL を返す（プロフィールの区分を使う）", async () => {
    const { env, docs } = fakeEnv({ studentType: "graduate" });
    const o = await getAbsenceForm(env, {});
    const d = okData(o);
    expect(d.category).toBe("大学院");
    expect((d.forms as { url: string }[]).map((f) => f.url)).toEqual([
      `${BASE}whole/graduate/absence_form.pdf`,
      `${BASE}whole/gakubu/medical_record.pdf`,
    ]);
    expect(docs.calls).toEqual([]);
  });

  it("様式名で絞り、保存するなら document_download と同じ保存を行ってパスを返す", async () => {
    const { env, docs } = fakeEnv();
    const o = await getAbsenceForm(env, { studentType: "学部", form: "受診", save: true });
    const d = okData(o);
    expect(d.forms).toEqual([
      {
        title: "受診記録票",
        url: `${BASE}whole/gakubu/medical_record.pdf`,
        ext: "pdf",
        requiresLogin: false,
        savedTo: "/tmp/srv_fake_dl/medical_record.pdf",
      },
    ]);
    expect(docs.calls).toEqual([`download ${BASE}whole/gakubu/medical_record.pdf`]);
    expect(o.sources).toContainEqual({ title: "受診記録票", url: `${BASE}whole/gakubu/medical_record.pdf`, lastModified: LM });
  });

  it("区分が分からなければ聞き返す", async () => {
    const o = await getAbsenceForm(fakeEnv().env, {});
    expect(o.status).toBe("needs_clarification");
  });
});

describe("findContact", () => {
  it("Q&A と窓口を用件で探し、部署・場所・電話・受付時間を返す", async () => {
    const o = await findContact(fakeEnv().env, { query: "欠席" });
    const d = okData(o);
    expect((d.faq as { q: string }[]).map((f) => f.q)).toEqual(["架空の欠席連絡はどこに出しますか。"]);
    // 回答に名前が出てくる窓口も挙げる
    expect((d.contacts as { name: string }[]).map((c) => c.name)).toEqual(["架空保健室"]);
    expect((d.contacts as Record<string, unknown>[])[0]).toMatchObject({ phone: "000-0000-0003", hours: "平日 9:00～19:00" });
    expect(o.sources).toEqual([{ title: "よくある質問・窓口", url: `${BASE}whole/inquiry.html`, lastModified: null }]);
  });

  it("窓口の担当業務でも当たる", async () => {
    const d = okData(await findContact(fakeEnv().env, { query: "成績" }));
    expect((d.contacts as { name: string }[]).map((c) => c.name)).toEqual(["架空センター 教務係"]);
  });

  it("当たらなければ窓口の一覧を返して聞き返す", async () => {
    const o = await findContact(fakeEnv().env, { query: "宇宙旅行" });
    expect(o.status).toBe("needs_clarification");
    if (o.status !== "needs_clarification") return;
    expect(o.candidates).toEqual(["架空センター 教務係", "架空保健室", "架空サービス株式会社"]);
  });
});
