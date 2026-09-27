/**
 * 合成サイトの HTML を組み立てる。
 *
 * id・class・body の id・要素の入れ子・アコーディオンの作りといった「セレクタが依存する形」は
 * 実サイトに合わせてあるが、HTML は一から書いたもので、文言はすべて架空。
 */
import {
  FAKE_YEARS,
  graduateDepts,
  graduateSections,
  undergradDepts,
  undergradSections,
  type FakeSection,
} from "./data.ts";
import { fakeCommonJs } from "./script.ts";

export interface FakeResponse {
  status: number;
  contentType: string;
  /** 合成サイトの応答はすべて ASCII / UTF-8 の文字列で表せるものにしている */
  body: string;
}

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** クイックリンク（ホームの `section.top_nav` とサイドメニュー `aside nav` の両方に出る） */
interface FakeQuick {
  /** ベースパスからの相対パス、または外部 URL */
  href: string;
  /** `<br>` で折り返す箇所を含むラベル片 */
  label: string[];
  updated?: string;
  external?: boolean;
}

const QUICK: FakeQuick[] = [
  { href: "whole/class_guide.html", label: ["時間割・", "履修の手引き"] },
  { href: "whole/gakubu/calendar.pdf", label: ["年間行事予定", "（架空）"] },
  { href: "whole/gakubu/shuttle.pdf", label: ["シャトル時刻表"], updated: "（更新 2026.09.01）" },
  { href: "https://dining.example.com/menu/", label: ["食堂メニュー"], external: true },
  { href: "whole/absence.html", label: ["欠席連絡・", "受診記録"] },
  { href: "whole/web_manual.html", label: ["申請様式・", "操作手引き"] },
  { href: "whole/gakubu/advisers.pdf", label: ["担任・", "相談員一覧"] },
  { href: "whole/gakubu/map.pdf", label: ["構内案内図"] },
  { href: "whole/link.html", label: ["関連サイト"] },
  { href: "whole/inquiry.html", label: ["よくある質問・", "窓口"] },
];

function quickItem(q: FakeQuick, prefix: string): string {
  const href = q.external ? q.href : prefix + q.href;
  const target = q.external || q.href.endsWith(".pdf") ? ' target="_blank"' : "";
  const label = `<span>${q.label.map(esc).join("<br>")}</span>`;
  const updated = q.updated ? `<br><span class="updated">${esc(q.updated)}</span>` : "";
  return `<li><a href="${esc(href)}"${target}>${label}${updated}</a></li>`;
}

interface LayoutOpts {
  basePath: string;
  /** そのページからベースへの相対（`""` / `"../"`） */
  rel: string;
  bodyId: string;
  bodyClass: string;
  title: string;
  article: string;
}

function layout(o: LayoutOpts): string {
  const side = QUICK.map((q) => quickItem(q, o.basePath)).join("\n\t\t");
  return `<!DOCTYPE html>
<html>
<head>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-FAKE000000"></script>
<script>window.dataLayer = window.dataLayer || []; function gtag(){dataLayer.push(arguments);} gtag('js', new Date());</script>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${esc(o.title)}</title>
<link rel="stylesheet" type="text/css" href="${o.rel}cmn/css/base.css">
<script type="text/javascript" src="${o.rel}cmn/js/common.js"></script>
</head>
<body id="${esc(o.bodyId)}" class="${esc(o.bodyClass)}">
<header>
	<div id="header_contents">
	<p id="logo"><a href="${o.basePath}">架空大学 資料室（合成サイト）</a></p>
	<p id="nav_btn"><a href="">メニュー</a></p>
</div></header>
<div id="content">
	<main>
		<article>
${o.article}
		</article>
	</main>
	<aside>
		<nav>
	<ul id="gmenu">
		${side}
	</ul>
</nav>	</aside>
</div>
<footer>
	<p id="copyright"><small>合成テスト用サイト。実在の組織とは関係ありません。</small></p>
</footer>
</body>
</html>
`;
}

const SITE_TITLE = "架空大学 資料室";

function homePage(basePath: string): string {
  const years = FAKE_YEARS.map((y) => `<option value="${y}">${y}</option>`).join("\n\t\t\t\t\t\t\t\t");
  const top = QUICK.map((q) => quickItem(q, "")).join("\n\t\t\t\t\t");
  const article = `
			<section class="news">
				<h1>NEWS<span>お知らせ</span></h1>
				<dl>
					<dt>2026年04月01日</dt>
					<dd>架空年度の資料を掲載しました。</dd>
					<dt>2026年03月31日</dt>
					<dd>架空の担任表と<a href="whole/web_manual.html">申請様式</a>を更新しました。</dd>
					<dt>2025年10月01日</dt>
					<dd>合成サイトのお知らせです。</dd>
				</dl>
			</section>
			<section class="search">
				<p class="lede">架空の説明文です。</p>
				<div class="search_wrap">
					<div class="search_detail">
						<ul class="input_student">
							<li><input type="radio" class="input_radio" id="rdo_gakubu" name="student" value="1" checked /><label for="rdo_gakubu">学部生</label></li>
							<li><input type="radio" class="input_radio" id="rdo_graduate" name="student" value="2" /><label for="rdo_graduate">大学院生</label></li>
						</ul>
						<div class="select_box">
							<select id="slt_year" name="year">
								<option value="" selected>入学年度</option>
								${years}
							</select>
						</div>
						<div class="select_box">
							<select id="slt_dept" name="dept">
								<option value="">学科・専攻</option>
							</select>
						</div>
						<p class="btn_search_submit">
							<input type="button" class="btn" value="検索" name="btn_submit" id="btn_submit">
						</p>
						<p class="no_students">学外の方は<a href="whole/handbook.html">こちら</a></p>
					</div>
				</div>
			</section>
			<section class="top_nav">
				<ul>
					${top}
				</ul>
			</section>`;
  return layout({ basePath, rel: "", bodyId: "home", bodyClass: "home", title: SITE_TITLE, article });
}

function collapseBlock(sections: FakeSection[]): string {
  const blocks = sections.map((s) => {
    const items = s.links
      .map((l) => `\t\t\t\t\t\t\t<li><a href="${esc(l.href)}" target="_blank">${esc(l.text)}</a></li>`)
      .join("\n");
    return `				<div class="collapse" data-parts="collapse__elm">
					<div class="collapse__trigger btn">
						<div class="collapse__title" data-parts="collapse__elm">${esc(s.title)}</div>
						<div class="collapse__icon"><span class="sr-only">Toggle button</span></div>
					</div>
					<div class="collapse__detail">
						<ul class="link_list">
${items}
						</ul>
					</div>
				</div>`;
  });
  return `			<div class="collapse-wrap" data-parts="collapse">
${blocks.join("\n")}
			</div>`;
}

function deptPage(basePath: string, year: number, name: string, slug: string, dir: string): string {
  const heading = `${year}年度入学　架空学部 ${name}`;
  const article = `			<h1>${esc(heading)}</h1>\n${collapseBlock(undergradSections(year, slug))}`;
  return layout({
    basePath,
    rel: "../",
    bodyId: `${slug}_${year}`,
    bodyClass: `second ${dir}`,
    title: `${heading} | ${SITE_TITLE}`,
    article,
  });
}

function graduatePage(basePath: string, year: number, school: string, schoolName: string): string {
  const heading = `${year}年度入学　大学院 ${schoolName}`;
  const article = `			<h1>${esc(heading)}</h1>\n${collapseBlock(graduateSections(year, school, schoolName))}`;
  return layout({
    basePath,
    rel: "../",
    bodyId: "graduate",
    bodyClass: "second graduate",
    title: `${heading} | ${SITE_TITLE}`,
    article,
  });
}

function wholePage(basePath: string, bodyId: string, title: string, article: string): string {
  return layout({
    basePath,
    rel: "../",
    bodyId,
    bodyClass: "second whole",
    title: `${title} | ${SITE_TITLE}`,
    article: `			<h1>${esc(title)}</h1>\n${article}`,
  });
}

function manualTable(rows: [string, string, string][]): string {
  const body = rows
    .map(
      ([href, text, office]) => `					<tr>
						<td><a href="${esc(href)}"${href.endsWith(".html") ? "" : ' target="_blank"'}>${esc(text)}</a></td>
						<td>${esc(office)}</td>
					</tr>`,
    )
    .join("\n");
  return `			<table>
				<colgroup><col class="w-70"><col class="w-30"></colgroup>
				<thead><tr><th>名称（架空）</th><th>担当（架空）</th></tr></thead>
				<tbody>
${body}
				</tbody>
			</table>`;
}

const LOGIN_NOTE = "（※学生専用/架空アカウントでログインしてください）";

function webManualPage(basePath: string): string {
  const cats: [string, [string, string, string][]][] = [
    [
      "架空の学生生活",
      [
        ["web_manual/cat_01_01.pdf", "架空の学びの手引き", "架空センター（学生係）"],
        ["web_manual/cat_01_02.pdf?20260101_01", "架空の保険のしおり", "架空センター（学生係）"],
        ["fake_archive.html", "架空の紹介冊子（デジタル版）", "架空センター（教務係）"],
      ],
    ],
    [
      "架空の授業・学位",
      [
        ["web_manual/cat_02_01.pdf", "架空の欠席連絡（学部）", "架空センター（教務係）"],
        ["web_manual/cat_02_02.xlsx", "架空の先取り履修志願書　※架空学年対象", "架空センター（教務係）"],
        ["web_manual/cat_02_03.doc", "（修士）架空の学位申請様式", "架空センター（教務係）"],
      ],
    ],
    [
      "架空のネットワーク",
      [
        ["https://drive.example.com/drive/folders/fake-network", `架空の学内ネットワーク案内${LOGIN_NOTE}`, "架空部（情報係）"],
        ["https://drive.example.com/drive/folders/fake-mail", "架空のメール利用方法", "架空部（情報係）"],
        ["https://drive.example.com/drive/folders/fake-vpn", `架空の VPN 接続${LOGIN_NOTE}`, "架空部（情報係）"],
      ],
    ],
    ["架空のその他", [["web_manual/cat_04_01.pdf", "架空の旅費援助 要項", "架空部（会計係）"]]],
  ];
  const anchors = cats
    .map(([name], i) => `				<li><a href="#anc-${i + 1}"><span>${esc(name)}</span></a></li>`)
    .join("\n");
  const sections = cats
    .map(([name, rows], i) => `			<h2 id="anc-${i + 1}">${esc(name)}</h2>\n${manualTable(rows)}`)
    .join("\n\n");
  return wholePage(
    basePath,
    "web_manual",
    "申請様式・操作手引き",
    `			<ul class="row link-anc-wrap">\n${anchors}\n			</ul>\n\n${sections}`,
  );
}

function btnList(title: string, links: [string, string][]): string {
  const items = links
    .map(([href, text]) => `				<li><a href="${esc(href)}" target="_blank">${esc(text)}</a></li>`)
    .join("\n");
  return `			<h2>${esc(title)}</h2>\n			<ul class="btn_link_list">\n${items}\n			</ul>`;
}

function absencePage(basePath: string): string {
  return wholePage(
    basePath,
    "absence",
    "欠席連絡・受診記録",
    [
      btnList("学部", [
        ["gakubu/absence_form.pdf", "欠席連絡票"],
        ["gakubu/medical_record.pdf", "受診記録票"],
      ]),
      btnList("大学院", [
        ["graduate/absence_form.pdf", "欠席連絡票"],
        ["gakubu/medical_record.pdf", "受診記録票"],
      ]),
    ].join("\n\n"),
  );
}

function classGuidePage(basePath: string): string {
  return wholePage(
    basePath,
    "class_guide",
    "時間割・履修の手引き",
    [
      btnList("学部", [
        ["https://drive.example.com/file/d/fake-eng/view", "架空工学部"],
        ["https://drive.example.com/file/d/fake-sim/view", "模擬情報学部"],
        ["https://drive.example.com/file/d/fake-design/view", "仮想デザイン学部"],
      ]),
      btnList("大学院", [["https://drive.example.com/file/d/fake-grad/view", "架空大学院"]]),
    ].join("\n\n"),
  );
}

function handbookPage(basePath: string): string {
  const years = [2026, 2025, 2024];
  const body = years
    .map((y) => {
      const items = [
        ["cat_fic", `handbook/handbook_${y}_fic.pdf`, "架空工学部"],
        ["cat_sim", `handbook/handbook_${y}_sim.pdf`, "模擬<br>情報学部"],
        ["cat_graduate", `handbook/handbook_${y}_graduate.pdf`, "大学院"],
      ]
        .map(([cls, href, label]) => `				<li class="${cls}"><a href="${href}" target="_blank">${label}</a></li>`)
        .join("\n");
      return `			<h2>${y}年度入学（架空）</h2>\n			<ul class="handbook_list">\n${items}\n			</ul>`;
    })
    .join("\n\n");
  return wholePage(
    basePath,
    "handbook",
    "学外の方",
    `			<p class="notice fred">※架空の注意書きです。</p>\n\n${body}`,
  );
}

function linkPage(basePath: string): string {
  const links: [string, string, string][] = [
    ["https://portal.example.com/", "架空ポータル", "…架空のポータルサイト"],
    ["https://lms.example.com/login", "架空学習システム", "…授業資料を確認できる架空のシステム"],
    ["https://syllabus.example.com/", "架空シラバス", "…授業内容を確認できます"],
    ["https://www.example.com/", "架空大学HP", ""],
  ];
  const body = links
    .map(
      ([href, text, desc]) =>
        `				<dt><a href="${esc(href)}" target="_blank">${esc(text)}</a></dt>\n				<dd>${esc(desc)}</dd>`,
    )
    .join("\n");
  return wholePage(basePath, "link", "関連サイト", `			<dl class="link_list">\n${body}\n			</dl>`);
}

function faqBlock(id: string, title: string, qa: [string, string][]): string {
  const items = qa
    .map(([q, a]) => `				<dt><span>Q</span>${q}</dt>\n				<dd><span>A</span>${a}</dd>`)
    .join("\n");
  return `			<h3 id="${id}">${esc(title)}</h3>\n			<dl class="faq">\n${items}\n			</dl>`;
}

interface FakeContact {
  title: string[];
  place?: string;
  tel?: string;
  time?: string[];
  service?: string;
  bare?: string;
}

function contactBox(c: FakeContact): string {
  const parts: string[] = [];
  if (c.place) parts.push(`<div class="inquiry_place">${c.place}</div>`);
  if (c.tel) parts.push(`<div class="inquiry_tel"><span class="tel_link">${esc(c.tel)}</span></div>`);
  if (c.time) parts.push(`<div class="inquiry_time">${c.time.map(esc).join("<br>")}</div>`);
  if (c.service) parts.push(`<div class="inquiry_service">担当業務（架空）<br>${esc(c.service)}</div>`);
  if (c.bare) parts.push(esc(c.bare));
  return `				<div class="col-md-6">
					<div class="inquiry-box">
						<dl>
							<dt class="inquiry_block_title">${c.title.map(esc).join("<br>")}</dt>
							<dd>
								${parts.join("\n\t\t\t\t\t\t\t\t")}
							</dd>
						</dl>
					</div>
				</div>`;
}

function inquiryPage(basePath: string): string {
  const faq = [
    faqBlock("anc-1", "架空の学生番号について", [
      [
        "架空の学生番号の見方がわかりません。",
        `架空の学生番号は年度・学科・個人番号の順に並びます。
					<ol class="bracket_num">
						<li>(a) は年度です。</li>
						<li>(b) は学科です。</li>
					</ol>
					<h4>＜架空の学科一覧＞</h4>
					<p>X1：架空工学科<br>Y2：模擬情報学科</p>`,
      ],
    ]),
    faqBlock("anc-2", "架空の欠席について", [
      ["架空の欠席連絡はどこに出しますか。", "架空センターの窓口に提出してください。"],
      ["架空の受診記録は必要ですか。", "必要に応じて<em class=\"underline\">受診記録票</em>を添えてください。"],
    ]),
    faqBlock("anc-3", "架空のアルバイトについて", [
      [
        "架空の学内アルバイトはありますか。",
        `あります。
					<table>
						<thead><tr><th>担当</th><th>種類</th></tr></thead>
						<tbody>
							<tr><td>架空係</td><td>受付補助</td></tr>
							<tr><td>模擬係</td><td>資料整理</td></tr>
						</tbody>
					</table>`,
      ],
    ]),
  ];
  const time = ["受付（平日）9:00～17:00", "（土）9:00～12:00"];
  const general: FakeContact[] = [
    { title: ["北キャンパス"], place: "架空1号館1階", time },
    { title: ["南キャンパス"], place: "架空2号館1階", time },
  ];
  const depts: FakeContact[] = [
    { title: ["架空センター　教務係", "北キャンパス"], place: "架空1号館1階", tel: "000-0000-0001", time, service: "架空の履修・成績" },
    { title: ["架空センター　教務係", "南キャンパス"], place: "架空2号館1階", tel: "000-0000-0002", time, service: "架空の履修・成績" },
    { title: ["架空保健室"], place: "北キャンパス：架空1号館1階<br>南キャンパス：架空2号館1階", time: ["受付（平日）9:00～19:00", "（休憩）12:30～13:30"], service: "架空の健康相談" },
    { title: ["架空サービス株式会社"], bare: "架空の推奨機器の問い合わせ先" },
  ];
  const box = (list: FakeContact[]): string => `			<div class="row">\n${list.map(contactBox).join("\n")}\n			</div>`;
  const article = `			<p class="btn_anc_inquiry"><a href="#anc-inquiry"><span>窓口はこちら</span></a></p>
			<h2>Q&amp;A</h2>
			<ul class="row link-anc-wrap">
				<li><a href="#anc-1"><span>架空の学生番号について</span></a></li>
				<li><a href="#anc-2"><span>架空の欠席について</span></a></li>
				<li><a href="#anc-3"><span>架空のアルバイトについて</span></a></li>
			</ul>
${faq.join("\n\n")}

			<h2 id="anc-inquiry">窓口一覧（架空）</h2>
			<h3>総合窓口（架空）</h3>
${box(general)}
			<h3>部署別連絡先（架空）</h3>
${box(depts)}`;
  return wholePage(basePath, "inquiry", "よくある質問・窓口", article);
}

const FAKE_CSS = `/* 合成サイト用の最小 CSS */
body { font-family: sans-serif; }
@media (max-width: 736px) { aside { display: none; } }
`;

/** 構造だけ正しい最小の PDF（本文は架空の 1 行。ASCII のみ） */
function fakePdf(label: string): string {
  const text = `FAKE PDF ${label}`.replace(/[^\x20-\x7e]|[()\\]/g, "");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${`BT /F1 10 Tf 10 50 Td (${text}) Tj ET`.length} >>\nstream\nBT /F1 10 Tf 10 50 Td (${text}) Tj ET\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}

const html = (body: string): FakeResponse => ({ status: 200, contentType: "text/html; charset=utf-8", body });

function notFound(path: string): FakeResponse {
  return {
    status: 404,
    contentType: "text/html; charset=utf-8",
    body: `<!DOCTYPE html><html><head><title>404 Not Found</title></head><body><h1>Not Found</h1><p>${esc(path)}</p></body></html>`,
  };
}

const GRAD_SCHOOLS: Record<string, string> = { fiction: "架空工学研究科", sim: "模擬情報研究科" };

/**
 * ベース URL からの相対パス（クエリ・ハッシュを除いたもの）に対する応答を返す。
 */
export function resolveFakePath(baseUrl: string, relPath: string): FakeResponse {
  const basePath = new URL(baseUrl).pathname;
  const path = relPath.replace(/^\/+/, "");

  if (path === "" || path === "index.html") return html(homePage(basePath));
  if (path === "cmn/js/common.js") {
    return { status: 200, contentType: "application/javascript; charset=utf-8", body: fakeCommonJs(baseUrl) };
  }
  if (path === "cmn/css/base.css") return { status: 200, contentType: "text/css; charset=utf-8", body: FAKE_CSS };

  switch (path) {
    case "whole/web_manual.html":
      return html(webManualPage(basePath));
    case "whole/absence.html":
      return html(absencePage(basePath));
    case "whole/class_guide.html":
      return html(classGuidePage(basePath));
    case "whole/handbook.html":
      return html(handbookPage(basePath));
    case "whole/link.html":
      return html(linkPage(basePath));
    case "whole/inquiry.html":
      return html(inquiryPage(basePath));
    case "whole/fake_archive.html":
      return html(wholePage(basePath, "fake_archive", "架空の紹介冊子", "			<p>架空の本文です。</p>"));
  }

  const grad = /^graduate\/(fiction|sim)_(\d{4})\.html$/.exec(path);
  if (grad) {
    const [, school = "", y = ""] = grad;
    const year = Number(y);
    if (FAKE_YEARS.includes(year) && graduateDepts(year).some((d) => d.path === path)) {
      return html(graduatePage(basePath, year, school, GRAD_SCHOOLS[school] ?? school));
    }
    return notFound(path);
  }

  const dept = /^(fic2?)\/([a-z]+)_(\d{4})\.html$/.exec(path);
  if (dept) {
    const [, dir = "", slug = "", y = ""] = dept;
    const year = Number(y);
    const d = FAKE_YEARS.includes(year) ? undergradDepts(year).find((x) => x.path === path) : undefined;
    if (!d) return notFound(path);
    const name = d.name.replace(/^[^：]+：/, "");
    return html(deptPage(basePath, year, name, slug, dir));
  }

  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  if (ext === "pdf") return { status: 200, contentType: "application/pdf", body: fakePdf(path) };
  if (ext === "doc") return { status: 200, contentType: "application/msword", body: "FAKE DOC" };
  if (ext === "xlsx") {
    return {
      status: 200,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      body: "FAKE XLSX",
    };
  }
  return notFound(path);
}
