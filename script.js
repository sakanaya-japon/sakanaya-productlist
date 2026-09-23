/* =========================================================
   伊勢志摩水産物輸出促進協議会 LP script.js（日英切替対応版）
   ---------------------------------------------------------
   ★ 最初にここだけ設定 ★ Gmail作成後にアドレスを書き換え
   ========================================================= */
const CONTACT_EMAIL = "generalaffairs.isec@gmail.com"; // ← 変更してください

// 動的コンテンツ用データ（お知らせ・事業計画/報告）：初期化前参照を避けるため冒頭で宣言
let newsData = [];
const NEWS_VISIBLE = 5;   // お知らせの初期表示件数（これを変えると表示数が変わります）
let newsExpanded = false; // 過去のお知らせを開いているか
let docsData = [];
let areaMarkers = []; // 志摩半島マップのピン
let productData = null;   // 取り扱い海産物（data/products.json）
let productFilter = "all"; // 現在選択中のカテゴリ

/* =========================================================
   YouTube動画の埋め込み設定
   ---------------------------------------------------------
   動画を追加するときは、URL末尾の動画ID
   （例 https://youtu.be/AbCdEf12345 → AbCdEf12345）を
   下の配列に追加するだけです。1本なら1列、2本以上は
   2列で「志摩からハノイへ」の下に表示されます。
   空の配列 [] にすると何も表示されません。
   ========================================================= */
const YOUTUBE_VIDEO_IDS = [
  "dSBWdKu2KIo",
  "8258t9bHzDg",
];

/* =========================================================
   メンバーカードのリンク設定
   ---------------------------------------------------------
   各メンバーのSNSやホームページを載せるときは、下の配列に
   { label: "表示名", url: "https://..." } を追加するだけです。
   個人アカウントの場合はラベルに（個人）を付けてください。
   例：
   inoue: [
     { label: "船上からの発信（Instagram・個人）", url: "https://www.instagram.com/xxxx" },
   ],
   ========================================================= */
const MEMBER_LINKS = {
  katayama: [{ label: "安乗からの発信（Instagram・個人）", url: "https://www.instagram.com/marusei.8/" },],
  inoue: [{ label: "志摩からの発信（Instagram・個人）", url: "https://www.instagram.com/kazumaru_sizima_/" },],
  ishikawa: [],
  hirooka: [],
  metis: [],
  katano: [],
  mukai: [],
};

/* =========================================================
   多言語辞書
   ・HTML側の data-i18n（テキスト）/ data-i18n-html（<br>等を含む）
     / data-i18n-ph（placeholder）/ data-i18n-content（meta）に対応。
   ・日本語はHTMLに直書きされているため、辞書はENのみ持ち、
     JA復帰時はページ読込時に退避した原文へ戻します。
   ========================================================= */
const I18N_EN = {
  "meta.title": "Iseshima Seafood Export Council | From Japan's sacred larder to the world.",
  "meta.desc": "Fishermen, wholesalers, processors and exporters of Ise-Shima, Japan, working as one council to deliver Shima's seafood to Hanoi, Vietnam.",

  "brand.name": "Iseshima Seafood Export Council",
  "brand.sub": "伊勢志摩水産物輸出促進協議会",

  "nav.about": "About",
  "nav.products": "Our Seafood",
  "nav.route": "Shima to Hanoi",
  "nav.members": "Members",
  "nav.news": "News",
  "nav.contact": "Contact",

  "hero.eyebrow": "Shima, Mie Prefecture — from the ports of Anori, Nakiri and Wagu",
  "hero.title": "Iseshima Seafood<br>Export Council",
  "hero.lead": "Fishermen, wholesalers, freezing &amp; processing, seaweed, and export trade.<br>Five partners of the Ise-Shima sea working as one,<br>bringing the pride of the day's catch to tables across the sea.",
  "hero.cta1": "See the route from Shima to Hanoi",
  "hero.cta2": "Talk to us about trade",
  "hero.cert.sqf": "SQF (GFSI-recognized)",
  "hero.tategaki": "From Japan's sacred larder, to the world.",

  "ports.caption": "Our home waters",
  "ports.p1": "Anori",
  "ports.p1n": "Port of Anori fugu — wholesale and processing under one roof",
  "ports.p2": "Nakiri",
  "ports.p2n": "Beneath the Daio Lighthouse — a town that lives with bonito",
  "ports.p3": "Wagu",
  "ports.p3n": "Home of the ama divers — Ise-ebi and abalone waters",

  "about.title": "Five crafts,<br class=\"sp-only\">bound by one sea.",
  "about.lead": "The Iseshima Seafood Export Council was founded by five partners of Shima: <strong>fishermen, a wholesaler, a freezing &amp; processing plant, a seaweed house, and an export trading company</strong>. Each of us brings a craft and a pride honed on our own sea, and together we carry the entire chain — catching, selecting, processing and delivering — as one. Two internationally certified plants (HACCP, SQF, JFS-B) and our own retail channels in Southeast Asia: we export the blessings of the Ise-Shima sea together with their freshness and trust.",
  "about.f1t": "Founded",
  "about.f1d": "July 2026",
  "about.f2t": "Head office",
  "about.f2d": "Anori, Ago-cho, Shima City, Mie, Japan",
  "about.f3t": "Members",
  "about.f3d": "4 companies + fishermen (Shima / Osaka)",
  "about.f4t": "First target market",
  "about.f4d": "Hanoi, Vietnam",

  "products.title": "Caught, selected, crafted.",
  "products.lead": "From fresh whole fish through primary, secondary and prepared processing to aquaculture. Five partners, each with their own role, delivering in the form your kitchen needs.",
  "products.c1t": "Fresh Fish",
  "products.c1d": "Seasonal fish caught by pole-and-line, set-net and gill-net. Selected on the day, by the eyes that know this sea best.",
  "products.c1tag": "Captain of F/V Dai-ichi Kazumaru and partner fishermen",
  "products.c2t": "Frozen & Processed",
  "products.c2d": "From fillets to prepared foods at a HACCP / SQF certified plant. Freshness sealed in, in formats ready for your kitchen.",
  "products.c2tag": "Shinsei Suisan & Iseshima Reito (on-site integrated processing)",
  "products.c3t": "Seaweed (Hijiki, Wakame & Aosa)",
  "products.c3d": "Selection and sterilization refined over 150 years. From a JFS-B certified plant, the aroma of Ise-Shima's shores to the world.",
  "products.c3tag": "Kaneu Foods (Shijima / Ugata plant)",
  "products.c4t": "Oysters",
  "products.c4d": "Raised in the calm inlets of Ise-Shima, exemplified by Matoya Bay. Delivering the wisdom of aquaculture to the next market.",
  "products.c4tag": "In partnership with Shima's oyster farmers (expanding)",

  "route.title": "Morning at a Shima port. Two days later, a table in Hanoi.",
  "route.lead": "Collection, processing and freezing are completed on a single site; from our base minutes from Haneda Airport, Hanoi is about six hours by direct flight. A relay of freshness is the blueprint of this route.",
  "route.s1t": "Landing",
  "route.s1d": "The day's catch from the ports of Anori, Nakiri and Wagu.",
  "route.s2t": "Processing & Freezing",
  "route.s2d": "Same-day processing at a HACCP / SQF certified plant, right by the port.",
  "route.s3t": "Airfreight from Haneda",
  "route.s3d": "From our export base near the airport — about 6 hours by direct flight.",
  "route.s4t": "To tables in Hanoi",
  "route.s4d": "Our own local sales channels carry it to the very last plate.",

  "why.title": "Trust is built on paper and on the ground.",
  "why.s1t": "Two internationally certified plants",
  "why.s1d": "HACCP, SQF (GFSI-recognized) and JFS-B. We meet destination standards facility-first.",
  "why.s2t": "A supply chain on one site",
  "why.s2d": "The processing plant sits inside the wholesaler's premises. From collection to frozen storage with zero transfer — freshness protected.",
  "why.s3t": "Our own channels in Southeast Asia",
  "why.s3d": "Export experience to Vietnam and Cambodia, with our own local retail. We trade within earshot of the market.",
  "why.s4t": "Small lots, wide variety",
  "why.s4d": "Fillets or prepared foods — flexible supply matched to your menu.",

  "members.title": "The five partners",
  "members.m1r": "Chair / Wholesale",
  "members.m1n": "Shinsei Suisan Co., Ltd.",
  "members.m1d": "The discerning eye and trade network of Ise-Shima (Anori, Shima)",
  "members.m2r": "Director / Freezing & Processing",
  "members.m2n": "Iseshima Reito Co., Ltd.",
  "members.m2d": "HACCP / SQF certified plant; exports to Hong Kong, Thailand and Singapore",
  "members.m3r": "Vice-chair / Fisherman",
  "members.m3n": "Captain, F/V Dai-ichi Kazumaru",
  "members.m3d": "The Shijima sea and its network of fishermen",
  "members.m4r": "Director / Seaweed",
  "members.m4n": "Kaneu Foods Co., Ltd.",
  "members.m4d": "Founded 150 years ago; JFS-B certified plant (Shijima / Ugata)",
  "members.m5r": "Secretariat / Export",
  "members.m5n": "METIS Co., Ltd.",
  "members.m5d": "Exports to Vietnam & Cambodia; export base minutes from Haneda",
  "members.adv": "Adviser: Ayumu Katano (FISK JAPAN) / In cooperation with Mie Prefecture, Shima City and JETRO Mie",
  "members.m1p": "Katsuhito Katayama",
  "members.m2p": "Takamasa Ishikawa",
  "members.m3p": "Kazu Inoue",
  "members.m4p": "Tatsukazu Hirooka",
  "members.m5p": "Yoshihisa Mitsunobu",
  "members.m6p": "Ayumu Katano",
  "members.m6r": "Adviser",
  "members.m6n": "FISK JAPAN",
  "members.m6d": "Expert guidance on seafood export and global fisheries",
  "members.m7r": "Auditor",
  "members.m7p": "Shingo Mukai",
  "members.m7n": "Nanbu Kyuso Co., Ltd.",
  "members.m7d": "A logistics specialist auditing the council independently of its members",
  "products.loading": "Loading…",

  "members.support": "Working in cooperation with Mie Prefecture, Shima City and JETRO Mie.",

  "news.title": "News",
  "news.tag1": "Notice",
  "news.tag2": "Business",
  "news.tag3": "Upcoming",
  "news.n1": "The Iseshima Seafood Export Council has been established.",
  "news.n2": "First shipment of Shima's used fishing vessels has departed (giving retired fishermen's boats a second life).",
  "news.n3": "Facility registration for Vietnam and international certification work begins.",

  "docs.title": "Documents",
  "docs.lead": "The council's articles and internal rules, along with its business plans and reports, are available as PDFs.",
  "docs.g1": "Rules & Regulations",
  "docs.g2": "Business Plans & Reports",
  "docs.loading": "Loading…",
  "docs.d1": "Articles of Association",
  "docs.d2": "Organizational Rules",
  "docs.d3": "Accounting Rules",
  "news.loading": "Loading…",

  "area.title": "The Shima Peninsula & Our Ports",
  "area.lead": "Cradled by Ise-Shima National Park, the Shima Peninsula is where sheltered ria inlets meet the Kuroshio Current. Our seafood comes from three ports open to the Pacific — Anori, Nakiri and Wagu — and from Matoya Bay.",
  "area.note": "Select a pin to see each location.",

  "contact.title": "Trade, visits and media inquiries",
  "contact.lead": "Overseas buyers, restaurants and retailers, press and government — we would love to hear from you.",
  "form.name": "Your name",
  "form.req": "Required",
  "form.req2": "Required",
  "form.req3": "Required",
  "form.name.ph": "e.g. John Smith",
  "form.org": "Company / Organization",
  "form.org.ph": "e.g. Hanoi Fine Foods Co., Ltd.",
  "form.mail": "Your email",
  "form.mail.ph": "e.g. you@example.com",
  "form.body": "Your inquiry",
  "form.body.ph": "e.g. We are looking to source fresh fish and frozen fillets for Japanese restaurants in Hanoi.",
  "form.note": "Pressing the button opens your email app with the message pre-filled.",
  "form.submit": "Send us an email",
  "form.alt": "If your email app does not open, please write to us directly:",

  "footer.name": "Iseshima Seafood Export Council",
  "footer.sub": "伊勢志摩水産物輸出促進協議会",
  "footer.addr": "Anori, Ago-cho, Shima City, Mie, Japan (c/o Shinsei Suisan Co., Ltd.)",
};

/* ---------------------------------------------------------
   言語切替の実装
   ・読込時に日本語原文（HTML直書き）を退避 → JA復帰に使用
   ・選択言語は localStorage に保存（使えない環境でも動作）
--------------------------------------------------------- */
const LANG_KEY = "iseshima_lp_lang";
const jaStore = { text: new Map(), html: new Map(), ph: new Map(), content: new Map() };

// 原文退避
document.querySelectorAll("[data-i18n]").forEach((el) => jaStore.text.set(el, el.textContent));
document.querySelectorAll("[data-i18n-html]").forEach((el) => jaStore.html.set(el, el.innerHTML));
document.querySelectorAll("[data-i18n-ph]").forEach((el) => jaStore.ph.set(el, el.getAttribute("placeholder") || ""));
document.querySelectorAll("[data-i18n-content]").forEach((el) => jaStore.content.set(el, el.getAttribute("content") || ""));

let currentLang = "ja";

function applyLang(lang) {
  currentLang = lang === "en" ? "en" : "ja";
  document.documentElement.lang = currentLang;

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    el.textContent = currentLang === "en" ? (I18N_EN[key] ?? jaStore.text.get(el)) : jaStore.text.get(el);
  });
  document.querySelectorAll("[data-i18n-html]").forEach((el) => {
    const key = el.getAttribute("data-i18n-html");
    el.innerHTML = currentLang === "en" ? (I18N_EN[key] ?? jaStore.html.get(el)) : jaStore.html.get(el);
  });
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => {
    const key = el.getAttribute("data-i18n-ph");
    el.setAttribute("placeholder", currentLang === "en" ? (I18N_EN[key] ?? jaStore.ph.get(el)) : jaStore.ph.get(el));
  });
  document.querySelectorAll("[data-i18n-content]").forEach((el) => {
    const key = el.getAttribute("data-i18n-content");
    el.setAttribute("content", currentLang === "en" ? (I18N_EN[key] ?? jaStore.content.get(el)) : jaStore.content.get(el));
  });

  // <title>（data-i18nを付けてあるが、明示的にも更新）
  document.title = currentLang === "en" ? I18N_EN["meta.title"] : jaStore.text.get(document.querySelector("title"));

  // 切替ボタンの表示状態
  document.querySelectorAll(".lang-opt").forEach((opt) => {
    opt.classList.toggle("is-current", opt.getAttribute("data-lang-opt") === currentLang);
  });

  // 選択を記憶（プライベートモード等で失敗しても無視）
  try { localStorage.setItem(LANG_KEY, currentLang); } catch (_) {}

  // 動的生成部（お知らせ・事業計画/報告）を再描画
  if (typeof renderNews === "function") renderNews();
  if (typeof renderDocs === "function") renderDocs();
  if (typeof refreshAreaMarkers === "function") refreshAreaMarkers();
  if (typeof renderProductTabs === "function") renderProductTabs();
  if (typeof renderProducts === "function") renderProducts();
}

// 初期言語：保存値 → ブラウザ言語 → 日本語
(function initLang() {
  let saved = null;
  try { saved = localStorage.getItem(LANG_KEY); } catch (_) {}
  const preferEn = (navigator.language || "").toLowerCase().startsWith("en");
  applyLang(saved || (preferEn ? "en" : "ja"));
})();

const langSwitch = document.getElementById("langSwitch");
if (langSwitch) {
  langSwitch.addEventListener("click", () => applyLang(currentLang === "ja" ? "en" : "ja"));
}

/* ---------------------------------------------------------
   ヘッダー：スクロールで背景切替
--------------------------------------------------------- */
const siteHeader = document.getElementById("siteHeader");
function updateHeader() {
  if (!siteHeader) return;
  siteHeader.classList.toggle("is-solid", window.scrollY > 40);
}
window.addEventListener("scroll", updateHeader, { passive: true });
updateHeader();

/* ---------------------------------------------------------
   モバイルナビ
--------------------------------------------------------- */
const navToggle = document.getElementById("navToggle");
const globalNav = document.getElementById("globalNav");
if (navToggle && globalNav) {
  navToggle.addEventListener("click", () => {
    const open = globalNav.classList.toggle("is-open");
    navToggle.classList.toggle("is-open", open);
    navToggle.setAttribute("aria-expanded", String(open));
  });
  globalNav.querySelectorAll("a").forEach((a) => {
    a.addEventListener("click", () => {
      globalNav.classList.remove("is-open");
      navToggle.classList.remove("is-open");
      navToggle.setAttribute("aria-expanded", "false");
    });
  });
}

/* ---------------------------------------------------------
   スクロール出現
--------------------------------------------------------- */
const revealObserver =
  "IntersectionObserver" in window
    ? new IntersectionObserver(
        (entries, observer) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add("is-visible");
              observer.unobserve(entry.target);
            }
          });
        },
        { rootMargin: "0px 0px -10% 0px", threshold: 0.1 }
      )
    : null;

function observeReveal(el) {
  if (revealObserver) revealObserver.observe(el);
  else el.classList.add("is-visible");
}

document.querySelectorAll(".reveal").forEach(observeReveal);

/* ---------------------------------------------------------
   航路ステップの点灯
--------------------------------------------------------- */
const routeSteps = document.querySelectorAll(".route-step");
if ("IntersectionObserver" in window && routeSteps.length > 0) {
  const stepObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        entry.target.classList.toggle("is-active", entry.isIntersecting);
      });
    },
    { rootMargin: "-30% 0px -30% 0px", threshold: 0 }
  );
  routeSteps.forEach((el) => stepObserver.observe(el));
}

/* ---------------------------------------------------------
   お問い合わせ（mailto方式）
   件名・本文は表示中の言語で組み立てます。
--------------------------------------------------------- */
const contactForm = document.getElementById("contactForm");

function buildMailto(name, org, email, body) {
  const en = currentLang === "en";
  const subject = en
    ? `[Inquiry] ${name} (${org || "Individual"})`
    : `【お問い合わせ】${name}様（${org || "個人"}）`;
  const lines = en
    ? [
        "To: Iseshima Seafood Export Council",
        "",
        `Name: ${name}`,
        `Company / Organization: ${org || "(not provided)"}`,
        `Email: ${email}`,
        "",
        "--- Inquiry ---",
        body,
        "",
        "* Composed from the website contact form.",
      ]
    : [
        "伊勢志摩水産物輸出促進協議会 御中",
        "",
        `お名前：${name}`,
        `会社名・団体名：${org || "（未記入）"}`,
        `ご連絡先メール：${email}`,
        "",
        "── ご相談内容 ──",
        body,
        "",
        "※本メールはWebサイトのお問い合わせフォームから作成されました。",
      ];
  return (
    "mailto:" + encodeURIComponent(CONTACT_EMAIL) +
    "?subject=" + encodeURIComponent(subject) +
    "&body=" + encodeURIComponent(lines.join("\n"))
  );
}

if (contactForm) {
  contactForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const nameInput = document.getElementById("cfName");
    const orgInput  = document.getElementById("cfOrg");
    const mailInput = document.getElementById("cfMail");
    const bodyInput = document.getElementById("cfBody");
    const note      = document.getElementById("formNote");

    let hasError = false;
    [nameInput, mailInput, bodyInput].forEach((input) => {
      const empty = input.value.trim() === "";
      input.classList.toggle("is-error", empty);
      if (empty) hasError = true;
    });
    const mailValue = mailInput.value.trim();
    if (mailValue !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mailValue)) {
      mailInput.classList.add("is-error");
      hasError = true;
    }

    if (hasError) {
      if (note) note.textContent = currentLang === "en"
        ? "Please check the highlighted fields (required / email format)."
        : "赤枠の項目をご確認ください（必須項目・メール形式）。";
      return;
    }
    if (note) note.textContent = currentLang === "en"
      ? "Opening your email app… (if nothing opens, use the address below)"
      : "メール作成画面を開いています…（開かない場合は下のアドレスへ直接ご連絡ください）";

    window.location.href = buildMailto(
      nameInput.value.trim(), orgInput.value.trim(), mailValue, bodyInput.value.trim()
    );
  });

  contactForm.querySelectorAll("input, textarea").forEach((input) => {
    input.addEventListener("input", () => input.classList.remove("is-error"));
  });
}

/* ---------------------------------------------------------
   フォールバックリンク＆年
--------------------------------------------------------- */
const mailFallback = document.getElementById("mailFallback");
if (mailFallback) {
  mailFallback.href = "mailto:" + CONTACT_EMAIL;
  mailFallback.textContent = CONTACT_EMAIL;
}
const yearEl = document.getElementById("year");
if (yearEl) yearEl.textContent = String(new Date().getFullYear());

/* =========================================================
   お知らせ／事業計画・報告の自動生成
   ---------------------------------------------------------
   ・お知らせ本文は  data/news.json     を編集するだけで更新できます。
   ・事業計画/報告は data/documents.json を編集し、
     PDFを docs/ に置くだけで一覧に追加されます（HTMLの編集は不要）。
   ・番号ルール：事業計画=P-YYMMDD／事業報告=R-YYMMDD（YYMMDD=承認日）。
   ========================================================= */
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
  );
}

function renderNews() {
  const list = document.getElementById("newsList");
  if (!list) return;
  if (!newsData.length) {
    list.innerHTML =
      '<li class="news-empty">' +
      (currentLang === "en" ? "No news yet." : "お知らせはまだありません。") +
      "</li>";
    return;
  }
  const total = newsData.length;
  const shown = newsExpanded ? newsData : newsData.slice(0, NEWS_VISIBLE);
  list.innerHTML = shown
    .map((n) => {
      const tag = currentLang === "en" ? n.tag_en || n.tag_ja : n.tag_ja;
      const title = currentLang === "en" ? n.title_en || n.title_ja : n.title_ja;
      const body = currentLang === "en" ? n.body_en || n.body_ja : n.body_ja;
      // 写真（photo）が指定されていればサムネイルを表示。画像が無ければ自動で消える
      const thumb = n.photo
        ? '<figure class="news-thumb"><img src="' + esc(n.photo) + '" alt="' +
          esc(title || body || "") + '" loading="lazy" ' +
          "onerror=\"this.closest('.news-thumb').remove()\"></figure>"
        : "";
      return (
        '<li class="reveal' + (n.photo ? " has-thumb" : "") + '"><time datetime="' +
        esc(n.datetime || "") +
        '">' +
        esc(n.date || "") +
        '</time>' +
        (tag ? '<span class="news-tag">' + esc(tag) + "</span>" : "") +
        thumb +
        '<div class="news-body">' +
        (title ? '<h3 class="news-title">' + esc(title) + "</h3>" : "") +
        (body ? "<p>" + esc(body) + "</p>" : "") +
        "</div></li>"
      );
    })
    .join("");
  list.querySelectorAll(".reveal").forEach(observeReveal);

  // 6件目以降がある場合のみ、開閉ボタンを表示
  const btnBox = document.getElementById("newsMore");
  if (btnBox) {
    if (total <= NEWS_VISIBLE) {
      btnBox.innerHTML = "";
    } else {
      const rest = total - NEWS_VISIBLE;
      const label = newsExpanded
        ? (currentLang === "en" ? "Show less" : "閉じる")
        : (currentLang === "en"
            ? "View past news (" + rest + ")"
            : "過去のお知らせを見る（" + rest + "件）");
      btnBox.innerHTML =
        '<button type="button" class="news-more-btn' + (newsExpanded ? " is-open" : "") +
        '" id="newsMoreBtn">' + esc(label) + "</button>";
      const btn = document.getElementById("newsMoreBtn");
      btn.addEventListener("click", () => {
        newsExpanded = !newsExpanded;
        renderNews();
        // 閉じたときは一覧の先頭が見えるように戻す
        if (!newsExpanded) {
          const sec = document.getElementById("news");
          if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    }
  }
}

function renderDocs() {
  const list = document.getElementById("plansList");
  if (!list) return;
  if (!docsData.length) {
    list.innerHTML =
      '<li class="news-empty">' +
      (currentLang === "en" ? "No documents yet." : "資料はまだありません。") +
      "</li>";
    return;
  }
  // 番号の日付部分（新しい順）で並べ替え
  const sorted = docsData
    .slice()
    .sort((a, b) => String(b.no).slice(2).localeCompare(String(a.no).slice(2)));
  list.innerHTML = sorted
    .map((d) => {
      const isReport = d.type === "report" || /^R-/.test(d.no || "");
      const cls = isReport ? "is-report" : "is-plan";
      const title = currentLang === "en" ? d.title_en || d.title_ja : d.title_ja;
      return (
        '<li class="reveal"><a href="' +
        esc(d.file) +
        '" target="_blank" rel="noopener">' +
        '<span class="docs-no ' + cls + '">' + esc(d.no) + "</span>" +
        "<span>" + esc(title) +
        (d.date ? '<span class="docs-date">' + esc(d.date) + "</span>" : "") +
        "</span>" +
        '<span class="docs-type">PDF</span></a></li>'
      );
    })
    .join("");
  list.querySelectorAll(".reveal").forEach(observeReveal);
}

/* ---------------------------------------------------------
   取り扱い海産物：カテゴリ別の描画
   ---------------------------------------------------------
   商品の追加・変更は data/products.json を編集するだけです。
   （このファイルを触る必要はありません）
--------------------------------------------------------- */
const PRODUCT_ICONS = {
  fish: '<svg viewBox="0 0 64 64"><path d="M8 32c10-12 26-14 38-6l10-8-3 12 3 12-10-8c-12 8-28 6-38-6z" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"/><circle cx="18" cy="30" r="2.2" fill="currentColor"/></svg>',
  snow: '<svg viewBox="0 0 64 64"><path d="M32 8v48M12 20l40 24M52 20L12 44M32 8l-6 8M32 8l6 8M32 56l-6-8M32 56l6-8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  pot: '<svg viewBox="0 0 64 64"><path d="M10 24h44v18a10 10 0 0 1-10 10H20a10 10 0 0 1-10-10V24z" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"/><path d="M6 30h4M54 30h4M24 16c0-4 4-4 4-8M36 16c0-4 4-4 4-8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  wave: '<svg viewBox="0 0 64 64"><path d="M20 56c0-14-6-18-4-30M32 56c0-18-4-22 0-40M44 56c0-14 6-18 4-30" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
};

function renderProductTabs() {
  const box = document.getElementById("productTabs");
  if (!box || !productData) return;
  const cats = productData.categories || [];
  const all = currentLang === "en" ? "All" : "すべて";
  const btns = [{ id: "all", label: all }].concat(
    cats.map((c) => ({ id: c.id, label: currentLang === "en" ? c.name_en : c.name_ja }))
  );
  box.innerHTML = btns.map((b) =>
    '<button type="button" class="product-tab' + (b.id === productFilter ? " is-active" : "") +
    '" data-cat="' + b.id + '">' + esc(b.label) + "</button>"
  ).join("");
  box.querySelectorAll(".product-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      productFilter = btn.dataset.cat;
      renderProductTabs();
      renderProducts();
    });
  });
}

function renderProducts() {
  const grid = document.getElementById("productGrid");
  if (!grid || !productData) return;
  const cats = {};
  (productData.categories || []).forEach((c) => { cats[c.id] = c; });
  const catsOf = (it) => (Array.isArray(it.category) ? it.category : [it.category]).filter(Boolean);
  const items = (productData.items || []).filter(
    (it) => productFilter === "all" || catsOf(it).indexOf(productFilter) !== -1
  );
  if (!items.length) {
    grid.innerHTML = '<p class="news-empty">' +
      (currentLang === "en" ? "No items in this category." : "このカテゴリの商品はまだありません。") + "</p>";
    return;
  }
  grid.innerHTML = items.map((it) => {
    const myCats = catsOf(it).map((id) => cats[id]).filter(Boolean);
    const first = myCats[0] || {};
    const name = currentLang === "en" ? (it.name_en || it.name_ja) : it.name_ja;
    const desc = currentLang === "en" ? (it.desc_en || it.desc_ja) : it.desc_ja;
    const member = currentLang === "en" ? (it.member_en || it.member_ja) : it.member_ja;
    const badges = myCats
      .map((c) => '<span class="product-cat">' + esc(currentLang === "en" ? c.name_en : c.name_ja) + "</span>")
      .join("");
    const icon = PRODUCT_ICONS[first.icon] || PRODUCT_ICONS.fish;
    return '<article class="product-card reveal">' +
      (it.photo
        ? '<figure class="product-photo"><img src="' + esc(it.photo) + '" alt="' + esc(name) +
          '" loading="lazy" onerror="this.closest(\'.product-photo\').remove()"></figure>'
        : "") +
      (badges ? '<div class="product-cats">' + badges + "</div>" : "") +
      '<div class="product-head"><div class="product-icon" aria-hidden="true">' + icon + "</div>" +
      "<h3>" + esc(name) + "</h3></div>" +
      "<p>" + esc(desc) + "</p>" +
      (member ? '<span class="product-tag">' + esc(member) + "</span>" : "") +
      "</article>";
  }).join("");
  grid.querySelectorAll(".reveal").forEach(observeReveal);
}

async function loadJson(url) {
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status);
    return await res.json();
  } catch (e) {
    console.warn("読み込みに失敗しました:", url, e);
    return null;
  }
}

(async function initDynamicContent() {
  const [news, docs, products] = await Promise.all([
    loadJson("data/news.json"),
    loadJson("data/documents.json"),
    loadJson("data/products.json"),
  ]);
  if (Array.isArray(news)) newsData = news;
  if (Array.isArray(docs)) docsData = docs;
  if (products && Array.isArray(products.items)) productData = products;
  renderNews();
  renderDocs();
  renderProductTabs();
  renderProducts();
})();

/* =========================================================
   志摩半島マップ（Leaflet）
   ---------------------------------------------------------
   拠点を追加・修正するときは AREA_SPOTS を編集するだけです。
   ========================================================= */
const AREA_SPOTS = [
  {
    lat: 34.36354, lng: 136.89618,
    name_ja: "安乗漁港", name_en: "Anori Port",
    desc_ja: "的矢湾の入口、安乗埼灯台のふもとに開けた港。ブランドとらふぐ「あのりふぐ」で知られ、外海の速い潮が身の締まった魚を育てます。心勢水産（仲買）と伊勢志摩冷凍（HACCP／SQF認証工場）が同じ敷地にあり、水揚げから凍結までを一か所で完結できる本会の中核拠点です。",
    desc_en: "At the mouth of Matoya Bay, beneath the Anori Lighthouse. Famed for Anori fugu, a branded tiger pufferfish raised firm by fast open-sea currents. Home to Shinsei Suisan (wholesale) and Iseshima Reito (HACCP/SQF-certified plant) on one site — our core base, from landing to freezing.",
  },
  {
    lat: 34.27788, lng: 136.89814,
    name_ja: "波切漁港", name_en: "Nakiri Port",
    desc_ja: "熊野灘と遠州灘がぶつかる海の難所・大王崎に抱かれた港町。古くから鰹漁とかつお節づくり（波切節）で栄え、石畳の坂道と大王埼灯台の風景は「絵かきの町」として画家たちに愛されてきました。荒々しい外洋が、伊勢えびをはじめ力強い魚を届けてくれます。",
    desc_en: "A port town sheltered by Cape Daio, where the Kumano and Enshu seas collide. Nakiri has long lived with bonito fishing and katsuobushi making, and its stone lanes beneath the Daio Lighthouse have drawn painters for generations. Its rough open waters yield Ise-ebi lobster and powerfully flavored fish.",
  },
  {
    lat: 34.25444, lng: 136.80391,
    name_ja: "和具漁港", name_en: "Wagu Port",
    desc_ja: "先志摩半島の中心に位置する、志摩でも指折りの漁師町。素潜りであわび・さざえを獲る海女漁の伝統が今も息づき、伊勢えびの刺網漁や沿岸漁業が盛んです。人の手と目で一つずつ獲る漁が、この海の資源を守り続けてきました。",
    desc_en: "The heart of the Sakishima Peninsula and one of Shima's great fishing towns. The ama free-diving tradition — harvesting abalone and turban shells by breath alone — lives on here, alongside gill-net fishing for Ise-ebi lobster. Catching one by one, by hand and eye, is how this sea has been kept abundant.",
  },
  {
    lat: 34.37239, lng: 136.88667,
    name_ja: "的矢湾", name_en: "Matoya Bay",
    desc_ja: "リアス海岸の静かな内湾。牡蠣養殖の産地として知られ、志摩の牡蠣漁業者との連携を広げています。",
    desc_en: "A calm ria-coast inlet renowned for oyster farming — where we are expanding partnerships with Shima's oyster growers.",
  },
];

function areaPopupHtml(s) {
  const name = currentLang === "en" ? s.name_en : s.name_ja;
  const desc = currentLang === "en" ? s.desc_en : s.desc_ja;
  return '<p class="area-pop-name">' + name + '</p><p class="area-pop-desc">' + desc + "</p>";
}

function refreshAreaMarkers() {
  areaMarkers.forEach((m) => {
    m.setPopupContent(areaPopupHtml(m._spot));
    const el = m.getElement();
    if (el) {
      const lbl = el.querySelector(".area-label");
      if (lbl) lbl.textContent = currentLang === "en" ? m._spot.name_en : m._spot.name_ja;
    }
  });
}

(function initAreaMap() {
  const el = document.getElementById("areaMap");
  if (!el || typeof L === "undefined") return;
  const map = L.map(el, { scrollWheelZoom: false, zoomControl: true });
  map.setView([34.32, 136.86], 11);
  // ベース地図：国土地理院 淡色地図（読み込み失敗時はOpenStreetMapへ自動切替）
  const gsiLayer = L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png", {
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html">国土地理院</a>',
    maxZoom: 18,
  });
  let tileFails = 0;
  gsiLayer.on("tileerror", () => {
    tileFails++;
    if (tileFails >= 3 && !map._fallbackApplied) {
      map._fallbackApplied = true;
      map.removeLayer(gsiLayer);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 18,
      }).addTo(map);
    }
  });
  gsiLayer.addTo(map);
  AREA_SPOTS.forEach((s) => {
    const icon = L.divIcon({
      className: "area-marker",
      html: '<span class="area-dot"></span><span class="area-label">' + s.name_ja + "</span>",
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
    const m = L.marker([s.lat, s.lng], { icon }).addTo(map).bindPopup(areaPopupHtml(s));
    m._spot = s;
    areaMarkers.push(m);
  });
  // 全ピンが収まるように表示範囲を自動調整
  map.fitBounds(L.latLngBounds(AREA_SPOTS.map((s) => [s.lat, s.lng])), { padding: [46, 46], maxZoom: 12 });
  refreshAreaMarkers();
})();


/* YouTube埋め込みの描画 */
(function initRouteVideo() {
  const box = document.getElementById("routeVideo");
  if (!box || !Array.isArray(YOUTUBE_VIDEO_IDS) || YOUTUBE_VIDEO_IDS.length === 0) return;
  box.hidden = false;
  box.classList.toggle("multi", YOUTUBE_VIDEO_IDS.length > 1);
  box.innerHTML = YOUTUBE_VIDEO_IDS.map((id) =>
    '<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/' + id +
    '?rel=0" title="協議会の動画" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>'
  ).join("");
})();


/* メンバーカードのリンク描画 */
(function initMemberLinks() {
  document.querySelectorAll(".member-links[data-links]").forEach((box) => {
    const items = (typeof MEMBER_LINKS === "object" && MEMBER_LINKS[box.dataset.links]) || [];
    box.innerHTML = items.map((l) =>
      '<a href="' + l.url + '" target="_blank" rel="noopener noreferrer">' + l.label + "</a>"
    ).join("");
  });
})();
