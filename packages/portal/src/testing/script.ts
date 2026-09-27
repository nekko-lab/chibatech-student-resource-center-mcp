/**
 * 合成サイト用の小さなスクリプト（自前で書いたもの。実サイトのスクリプトは使っていない）。
 *
 * 再現する挙動:
 * - 区分ラジオをクリックすると入学年度と学科の選択がリセットされる
 * - 入学年度の change で学科の option（「コード：名称」）が生成される
 * - 入学年度が未選択のまま学科の select をクリックすると alert
 * - 検索ボタン: 未選択なら alert、選択済みなら location.href で学科ページへ遷移
 * - アコーディオン: 幅 737px 未満では閉じた状態で始まり、見出しクリックで開閉する
 * - 幅 737px の境界をまたぐリサイズでページを再読込する
 * - Q&A ページ（body#inquiry）では `.faq dd` を閉じ、`dt` クリックで開閉する
 */
import { FAKE_YEARS, graduateDepts, undergradDepts } from "./data.ts";

export const BREAKPOINT = 737;

/** 合成サイトの alert 文言（架空） */
export const FAKE_ALERT_YEAR = "（合成）先に入学年度を選んでください。";
export const FAKE_ALERT_SUBMIT = "（合成）入学年度と学科・専攻を選んでください。";

export function fakeCommonJs(baseUrl: string): string {
  const table: Record<"1" | "2", Record<string, { dept: string; name: string; url: string }[]>> = { "1": {}, "2": {} };
  for (const y of FAKE_YEARS) {
    table["1"][y] = undergradDepts(y).map((d) => ({ dept: d.dept, name: d.name, url: new URL(d.path, baseUrl).href }));
    table["2"][y] = graduateDepts(y).map((d) => ({ dept: d.dept, name: d.name, url: new URL(d.path, baseUrl).href }));
  }
  return `(function () {
  "use strict";
  var BP = ${BREAKPOINT};
  var TABLE = ${JSON.stringify(table)};
  var MSG_YEAR = ${JSON.stringify(FAKE_ALERT_YEAR)};
  var MSG_SUBMIT = ${JSON.stringify(FAKE_ALERT_SUBMIT)};
  var mode = document.documentElement.clientWidth < BP ? "SP" : "PC";

  window.addEventListener("resize", function () {
    var w = document.documentElement.clientWidth;
    if ((w < BP && mode === "PC") || (w >= BP && mode === "SP")) {
      location.href = location.href;
    }
  });

  function each(sel, fn) {
    Array.prototype.forEach.call(document.querySelectorAll(sel), fn);
  }

  function toggleNext(trigger, detail) {
    trigger.addEventListener("click", function () {
      trigger.classList.toggle("active");
      detail.style.display = detail.style.display === "none" ? "" : "none";
    });
  }

  function resetDept(dept) {
    dept.innerHTML = "";
    var o = document.createElement("option");
    o.value = "";
    o.textContent = "学科・専攻";
    dept.appendChild(o);
  }

  function studentValue() {
    var r = document.querySelector('input[name="student"]:checked');
    return r ? r.value : "1";
  }

  document.addEventListener("DOMContentLoaded", function () {
    each(".collapse__trigger", function (t) {
      var d = t.nextElementSibling;
      if (!d || !d.classList.contains("collapse__detail")) return;
      if (mode === "SP") d.style.display = "none";
      toggleNext(t, d);
    });

    if (document.body.id === "inquiry") {
      each(".faq dt", function (dt) {
        var dd = dt.nextElementSibling;
        if (!dd || dd.tagName !== "DD") return;
        dd.style.display = "none";
        toggleNext(dt, dd);
      });
    }

    if (document.body.id !== "home") return;

    var year = document.getElementById("slt_year");
    var dept = document.getElementById("slt_dept");
    var submit = document.getElementById("btn_submit");

    each('input[name="student"]', function (r) {
      r.addEventListener("click", function () {
        year.selectedIndex = 0;
        resetDept(dept);
      });
    });

    year.addEventListener("change", function () {
      resetDept(dept);
      if (year.value === "") return;
      var rows = (TABLE[studentValue()] || {})[year.value] || [];
      rows.forEach(function (row) {
        var o = document.createElement("option");
        o.value = row.dept;
        o.textContent = row.name;
        dept.appendChild(o);
      });
    });

    dept.addEventListener("click", function () {
      if (year.value === "") alert(MSG_YEAR);
    });

    submit.addEventListener("click", function () {
      if (year.value === "" || dept.value === "") {
        alert(MSG_SUBMIT);
        return;
      }
      var rows = (TABLE[studentValue()] || {})[year.value] || [];
      var url = "";
      rows.forEach(function (row) {
        if (row.dept === dept.value) url = row.url;
      });
      location.href = url;
    });
  });
})();
`;
}
