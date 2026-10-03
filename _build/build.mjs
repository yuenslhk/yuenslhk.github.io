#!/usr/bin/env node
// 器材札記 Camera Notes — static public-site generator.
// Reads the Claude artifact's database export (posts/*.json, meta/site.json, images/*.json)
// and writes a complete static website for GitHub Pages.
//
//   node build.mjs <dataDir> <outDir>
//
// Only posts with status "published" are included. Drafts never leave the Claude site.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const [, , DATA = "data", OUT = "out"] = process.argv;

/* ---------------- load ---------------- */
const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const listJson = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")) : []);
const strip = (o) => { const x = { ...o }; delete x.version; delete x.updatedAt__meta; return x; };

const DEFAULT_SITE = { titleZh: "器材札記", titleEn: "Camera Notes", tagZh: "相機器材的知識與逸事", tagEn: "Knowledge and stories of camera gear", categories: [] };
const site = { ...DEFAULT_SITE, ...(fs.existsSync(path.join(DATA, "meta/site.json")) ? strip(readJson(path.join(DATA, "meta/site.json"))) : {}) };
const SITE_URL = (process.env.SITE_URL || site.publicUrl || "https://yuenslhk.github.io").replace(/\/+$/, "");
const CF_TOKEN = (process.env.CF_BEACON || site.cfBeacon || "").trim();
const AUTHOR = site.author || "Siu Lun Yuen";

const posts = listJson(path.join(DATA, "posts"))
  .map((f) => ({ id: f.replace(/\.json$/, ""), ...strip(readJson(path.join(DATA, "posts", f))) }))
  .filter((p) => p.status === "published" && /^[A-Za-z0-9_-]{1,80}$/.test(p.id))
  .map((p) => ({ ...p, tags: Array.isArray(p.tags) ? p.tags : [] }))
  .sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.no || 0) - (a.no || 0));

/* ---------------- helpers ---------------- */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pick = (o, base, l) => ((o[base + (l === "zh" ? "Zh" : "En")] || "").trim()) || ((o[base + (l === "zh" ? "En" : "Zh")] || "").trim());
const hasLang = (p, l) => !!(((p["title" + (l === "zh" ? "Zh" : "En")]) || "").trim() || ((p["body" + (l === "zh" ? "Zh" : "En")]) || "").trim());
const T = {
  zh: { search: "搜尋文章、器材、年份…", all: "全部", cats: "分類", tags: "標籤", results: "找到 {n} 篇", noMatch: "找不到相符的文章，試試其他關鍵字。",
    back: "← 返回首頁", related: "相關文章", onlyOther: "此文暫只有英文版。", clear: "清除篩選", uncategorised: "未分類", notFound: "找不到這頁。", rss: "RSS 訂閱", moreTags: "更多標籤" },
  en: { search: "Search posts, gear, years…", all: "All", cats: "Categories", tags: "Tags", results: "{n} found", noMatch: "Nothing matches. Try another keyword.",
    back: "← Home", related: "Related posts", onlyOther: "This post is only available in Chinese.", clear: "Clear filters", uncategorised: "Uncategorised", notFound: "Page not found.", rss: "RSS feed", moreTags: "More tags" },
};
const catName = (id, l) => { const c = (site.categories || []).find((c) => c.id === id); return c ? (l === "zh" ? c.zh || c.en : c.en || c.zh) : T[l].uncategorised; };
const fmtDate = (d) => (d || "").replace(/-/g, ".");
const no = (n) => "No." + String(n || 0).padStart(3, "0");
const stripMd = (s) => (s || "").replace(/```[\s\S]*?```/g, "").replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
  .replace(/[#>*_`~]/g, "").replace(/^\s*-\s+/gm, "").replace(/\s+/g, " ").trim();
const excerpt = (p, l, n = 140) => pick(p, "excerpt", l) || stripMd(pick(p, "body", l)).slice(0, n);
const pre = (l) => (l === "en" ? "/en" : "");
const postUrl = (p, l) => `${pre(l)}/post/${encodeURIComponent(p.id)}/`;

/* ---------------- images ---------------- */
const imgExt = {};
function writeImages() {
  fs.mkdirSync(path.join(OUT, "img"), { recursive: true });
  for (const f of listJson(path.join(DATA, "images"))) {
    const id = f.replace(/\.json$/, "");
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) continue;
    const m = /^data:image\/(jpeg|png|webp|gif);base64,(.+)$/.exec(readJson(path.join(DATA, "images", f)).src || "");
    if (!m) continue;
    const ext = m[1] === "jpeg" ? "jpg" : m[1];
    imgExt[id] = ext;
    fs.writeFileSync(path.join(OUT, "img", `${id}.${ext}`), Buffer.from(m[2], "base64"));
  }
}
const imgSrc = (id) => (imgExt[id] ? `/img/${id}.${imgExt[id]}` : null);

/* ---------------- markdown ---------------- */
function imgTag(u, alt) {
  if (u.startsWith("#img-")) { const s = imgSrc(u.slice(5)); return s ? `<img src="${s}" alt="${alt}" loading="lazy">` : ""; }
  if (/^https:\/\//i.test(u)) return `<img src="${u}" alt="${alt}" loading="lazy">`;
  return "";
}
function inline(s) {
  const codes = [];
  s = esc(s).replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  const safeUrl = (u) => (/^(https?:|mailto:|#|\/)/i.test(u) ? u : "#");
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, a, u) => imgTag(u, a))
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, a, u) => `<a href="${safeUrl(u)}" target="_blank" rel="noopener">${a}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}
function md(src) {
  const lines = (src || "").replace(/\r/g, "").split("\n"); const out = []; let i = 0;
  while (i < lines.length) {
    const L = lines[i]; let m;
    if (/^```/.test(L)) { const b = []; i++; while (i < lines.length && !/^```/.test(lines[i])) b.push(lines[i++]); i++; out.push(`<pre><code>${esc(b.join("\n"))}</code></pre>`); continue; }
    if (!L.trim()) { i++; continue; }
    if ((m = L.match(/^(#{1,4})\s+(.*)/))) { const lv = Math.min(4, Math.max(2, m[1].length)); out.push(`<h${lv}>${inline(m[2])}</h${lv}>`); i++; continue; }
    if (/^(-{3,}|\*{3,})\s*$/.test(L)) { out.push("<hr>"); i++; continue; }
    if ((m = L.match(/^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/))) { const img = imgTag(m[2], esc(m[1])); if (img) out.push(`<figure>${img}${m[1] ? `<figcaption>${inline(m[1])}</figcaption>` : ""}</figure>`); i++; continue; }
    if (/^>\s?/.test(L)) { const b = []; while (i < lines.length && /^>\s?/.test(lines[i])) b.push(lines[i++].replace(/^>\s?/, "")); out.push(`<blockquote>${md(b.join("\n"))}</blockquote>`); continue; }
    if (/^\s*[-*]\s+/.test(L)) { const b = []; while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) b.push(`<li>${inline(lines[i++].replace(/^\s*[-*]\s+/, ""))}</li>`); out.push(`<ul>${b.join("")}</ul>`); continue; }
    if (/^\s*\d+[.)]\s+/.test(L)) { const b = []; while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) b.push(`<li>${inline(lines[i++].replace(/^\s*\d+[.)]\s+/, ""))}</li>`); out.push(`<ol>${b.join("")}</ol>`); continue; }
    const b = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|>|\s*[-*]\s+|\s*\d+[.)]\s+|!\[[^\]]*\]\([^)]*\)\s*$)/.test(lines[i])) b.push(inline(lines[i++]));
    if (!b.length) b.push(inline(lines[i++]));
    out.push(`<p>${b.join("<br>")}</p>`);
  }
  return out.join("\n");
}

/* ---------------- layout ---------------- */
const scale = (() => {
  const marks = ["∞", "30", "15", "10", "7", "5", "4", "3", "2.5", "2", "1.7", "1.5", "1.2", "1", "m"];
  return marks.map((m, i) => `<span${m === "3" ? ' class="hi"' : ""} style="left:calc(${(i / (marks.length - 1)) * 100}%${i === 0 ? " + 6px" : i === marks.length - 1 ? " - 8px" : ""})">${m}</span>`).join("");
})();
function page({ lang, title, desc, pathZh, pathEn, image, body, type = "website", noindex = false, extraHead = "" }) {
  const t = T[lang];
  const siteTitle = pick(site, "title", lang);
  const self = lang === "zh" ? pathZh : pathEn;
  return `<!doctype html>
<html lang="${lang === "zh" ? "zh-Hant" : "en"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title ? `${title} · ${siteTitle}` : siteTitle)}</title>
<meta name="description" content="${esc(desc || pick(site, "tag", lang))}">
<meta name="author" content="${esc(AUTHOR)}">
${noindex ? '<meta name="robots" content="noindex">' : ""}
<link rel="canonical" href="${SITE_URL}${self}">
<link rel="alternate" hreflang="zh-Hant" href="${SITE_URL}${pathZh}">
<link rel="alternate" hreflang="en" href="${SITE_URL}${pathEn}">
<link rel="alternate" hreflang="x-default" href="${SITE_URL}${pathZh}">
<link rel="alternate" type="application/rss+xml" title="${esc(siteTitle)}" href="${pre(lang)}/rss.xml">
<meta property="og:site_name" content="${esc(siteTitle)}">
<meta property="og:title" content="${esc(title || siteTitle)}">
<meta property="og:description" content="${esc(desc || pick(site, "tag", lang))}">
<meta property="og:type" content="${type}">
<meta property="og:url" content="${SITE_URL}${self}">
<meta property="og:locale" content="${lang === "zh" ? "zh_HK" : "en_GB"}">
${image ? `<meta property="og:image" content="${SITE_URL}${image}"><meta name="twitter:card" content="summary_large_image">` : '<meta name="twitter:card" content="summary">'}
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600&family=Newsreader:opsz,wght@6..72,500;6..72,600&family=Noto+Sans+TC:wght@400;500;700&family=Noto+Serif+TC:wght@600;700&display=swap">
<link rel="stylesheet" href="/styles.css?v=${BUILD}">
<script src="/app.js?v=${BUILD}" defer></script>
${CF_TOKEN ? `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='${JSON.stringify({ token: CF_TOKEN })}'></script>` : ""}
${extraHead}
</head>
<body data-lang="${lang}">
<div class="wrap">
  <header class="mast">
    <a class="brand" href="${pre(lang)}/">
      <span class="brand-title">${esc(siteTitle)}</span>
      <span class="brand-tag">${esc(pick(site, "tag", lang))}</span>
    </a>
    <nav class="tools" aria-label="Language">
      <div class="seg">
        <a href="${pathZh}" data-lang-link="zh" aria-current="${lang === "zh"}">中</a>
        <a href="${pathEn}" data-lang-link="en" aria-current="${lang === "en"}">EN</a>
      </div>
    </nav>
  </header>
  <div class="scale" aria-hidden="true">${scale}</div>
  <main>${body}</main>
  <footer class="foot">
    <span>© ${new Date().getFullYear()} ${esc(AUTHOR)}</span>
    <a href="${pre(lang)}/rss.xml">${t.rss}</a>
  </footer>
</div>
</body>
</html>`;
}

/* ---------------- pages ---------------- */
function homePage(lang) {
  const t = T[lang];
  const catCount = new Map(), tagCount = new Map();
  for (const p of posts) { catCount.set(p.category, (catCount.get(p.category) || 0) + 1); for (const tg of p.tags) tagCount.set(tg, (tagCount.get(tg) || 0) + 1); }
  const tagsSorted = [...tagCount].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const card = (p) => {
    const cover = imgSrc(p.cover);
    return `<article class="card${cover ? "" : " nocover"}" data-id="${esc(p.id)}" data-cat="${esc(p.category || "")}" data-tags="${esc(JSON.stringify(p.tags))}">
      <div class="card-text">
        <div class="meta"><span class="no">${no(p.no)}</span><span>${fmtDate(p.date)}</span><a href="?cat=${encodeURIComponent(p.category || "")}" data-filter-cat="${esc(p.category || "")}">${esc(catName(p.category, lang))}</a></div>
        <h2><a href="${postUrl(p, lang)}">${esc(pick(p, "title", lang))}</a></h2>
        <p>${esc(excerpt(p, lang))}</p>
        ${p.tags.length ? `<div class="tags">${p.tags.slice(0, 6).map((tg) => `<a class="tag" href="?tag=${encodeURIComponent(tg)}" data-filter-tag="${esc(tg)}">${esc(tg)}</a>`).join("")}${p.tags.length > 6 ? `<span class="tag more">+${p.tags.length - 6}</span>` : ""}</div>` : ""}
      </div>
      ${cover ? `<a class="thumb" href="${postUrl(p, lang)}" tabindex="-1" aria-hidden="true"><img src="${cover}" alt="" loading="lazy"></a>` : ""}
    </article>`;
  };
  const body = `<div class="grid">
    <div class="maincol">
      <form class="search" role="search" onsubmit="return false">
        <input type="search" id="q" name="q" placeholder="${esc(t.search)}" aria-label="${esc(t.search)}" autocomplete="off">
      </form>
      <div class="filterbar" id="filterbar" hidden data-results="${esc(t.results)}" data-clear="${esc(t.clear)}"></div>
      <div class="list" id="list">${posts.map(card).join("")}</div>
      <div class="empty" id="nomatch" hidden>${t.noMatch}</div>
    </div>
    <aside class="side">
      <section><h3>${t.cats}</h3><ul class="catlist" id="catlist">
        <li class="on" data-cat=""><a href="${pre(lang)}/"><span>${t.all}</span><span class="n">${posts.length}</span></a></li>
        ${(site.categories || []).map((c) => `<li data-cat="${esc(c.id)}"><a href="?cat=${encodeURIComponent(c.id)}"><span>${esc(catName(c.id, lang))}</span><span class="n">${catCount.get(c.id) || 0}</span></a></li>`).join("")}
      </ul></section>
      <section class="tagsec"><h3>${t.tags}</h3><div class="tagcloud" id="tagcloud">
        ${tagsSorted.map(([tg, n], i) => `<a class="chip"${i >= 40 ? " hidden data-more" : ""} href="?tag=${encodeURIComponent(tg)}" data-tag="${esc(tg)}">${esc(tg)}<span class="n">${n}</span></a>`).join("")}
        ${tagsSorted.length > 40 ? `<button class="chip" type="button" id="moretags">${t.moreTags} +${tagsSorted.length - 40}</button>` : ""}
      </div></section>
    </aside>
  </div>
  <script type="application/json" id="catnames">${JSON.stringify(Object.fromEntries((site.categories || []).map((c) => [c.id, catName(c.id, lang)]))).replace(/</g, "\\u003c")}</script>`;
  const ld = { "@context": "https://schema.org", "@type": "Blog", name: pick(site, "title", lang), description: pick(site, "tag", lang), url: SITE_URL + pre(lang) + "/", inLanguage: lang === "zh" ? "zh-Hant" : "en", author: { "@type": "Person", name: AUTHOR } };
  return page({ lang, pathZh: "/", pathEn: "/en/", body, extraHead: `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>` });
}
function postPage(p, lang) {
  const t = T[lang];
  const cl = hasLang(p, lang) ? lang : lang === "zh" ? "en" : "zh";
  const cover = imgSrc(p.cover);
  const rel = posts.filter((x) => x.id !== p.id)
    .map((x) => ({ x, s: x.tags.filter((tg) => p.tags.includes(tg)).length * 2 + (x.category === p.category ? 1 : 0) }))
    .filter((r) => r.s > 0).sort((a, b) => b.s - a.s).slice(0, 5);
  const title = pick(p, "title", lang);
  const body = `<article class="article" data-post="${esc(p.id)}">
    <a class="back" href="${pre(lang)}/">${t.back}</a>
    <div class="meta"><span class="no">${no(p.no)}</span><time datetime="${esc(p.date)}">${fmtDate(p.date)}</time><a href="${pre(lang)}/?cat=${encodeURIComponent(p.category || "")}">${esc(catName(p.category, lang))}</a></div>
    <h1>${esc(title)}</h1>
    ${hasLang(p, lang) ? "" : `<div class="note">${t.onlyOther}</div>`}
    <div class="tts" id="tts" hidden data-lang="${cl}"></div>
    ${cover ? `<img class="cover" src="${cover}" alt="${esc(title)}">` : ""}
    <div class="prose" lang="${cl === "zh" ? "zh-Hant" : "en"}">${md(pick(p, "body", lang))}</div>
    ${p.tags.length ? `<div class="tags">${p.tags.map((tg) => `<a class="tag" href="${pre(lang)}/?tag=${encodeURIComponent(tg)}">${esc(tg)}</a>`).join("")}</div>` : ""}
    ${rel.length ? `<section class="related"><div class="label">${t.related}</div>${rel.map(({ x }) => `<a class="item" href="${postUrl(x, lang)}"><span class="no">${no(x.no)}</span>${esc(pick(x, "title", lang))}</a>`).join("")}</section>` : ""}
  </article>`;
  const ld = { "@context": "https://schema.org", "@type": "BlogPosting", headline: title, datePublished: p.date, dateModified: (p.updatedAt || p.date || "").slice(0, 10) || p.date,
    inLanguage: cl === "zh" ? "zh-Hant" : "en", author: { "@type": "Person", name: AUTHOR }, keywords: p.tags.join(", "),
    mainEntityOfPage: SITE_URL + postUrl(p, lang), ...(cover ? { image: SITE_URL + cover } : {}) };
  return page({ lang, title, desc: excerpt(p, lang, 160), pathZh: postUrl(p, "zh"), pathEn: postUrl(p, "en"), image: cover, type: "article", body,
    extraHead: `<meta property="article:published_time" content="${esc(p.date)}">${p.tags.map((tg) => `<meta property="article:tag" content="${esc(tg)}">`).join("")}<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>` });
}
function notFoundPage() {
  return page({ lang: "zh", title: "404", pathZh: "/404.html", pathEn: "/404.html", noindex: true,
    body: `<div class="article"><a class="back" href="/">← 返回首頁 Home</a><div class="empty">找不到這頁。Page not found.</div></div>` });
}
function rss(lang) {
  const items = posts.slice(0, 30).map((p) => `<item>
  <title>${esc(pick(p, "title", lang))}</title>
  <link>${SITE_URL}${postUrl(p, lang)}</link>
  <guid isPermaLink="true">${SITE_URL}${postUrl(p, lang)}</guid>
  <pubDate>${new Date((p.date || "2026-01-01") + "T12:00:00Z").toUTCString()}</pubDate>
  ${p.tags.map((tg) => `<category>${esc(tg)}</category>`).join("")}
  <description>${esc(excerpt(p, lang, 300))}</description>
</item>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
<title>${esc(pick(site, "title", lang))}</title>
<link>${SITE_URL}${pre(lang)}/</link>
<atom:link href="${SITE_URL}${pre(lang)}/rss.xml" rel="self" type="application/rss+xml"/>
<description>${esc(pick(site, "tag", lang))}</description>
<language>${lang === "zh" ? "zh-hant" : "en-gb"}</language>
${items}
</channel></rss>`;
}
function sitemap() {
  const u = (loc, alt, mod) => `<url><loc>${SITE_URL}${loc}</loc>${mod ? `<lastmod>${mod}</lastmod>` : ""}<xhtml:link rel="alternate" hreflang="zh-Hant" href="${SITE_URL}${alt.zh}"/><xhtml:link rel="alternate" hreflang="en" href="${SITE_URL}${alt.en}"/></url>`;
  const rows = [u("/", { zh: "/", en: "/en/" }), u("/en/", { zh: "/", en: "/en/" })];
  for (const p of posts) {
    const alt = { zh: postUrl(p, "zh"), en: postUrl(p, "en") }; const mod = (p.updatedAt || p.date || "").slice(0, 10);
    rows.push(u(alt.zh, alt, mod), u(alt.en, alt, mod));
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${rows.join("\n")}\n</urlset>\n`;
}
function searchIndex() {
  return posts.map((p) => ({ id: p.id, s: [p.titleZh, p.titleEn, p.excerptZh, p.excerptEn, stripMd(p.bodyZh), stripMd(p.bodyEn), p.tags.join(" "), catName(p.category, "zh"), catName(p.category, "en"), no(p.no)].join(" \u0001 ").toLowerCase() }));
}

/* ---------------- write ---------------- */
const BUILD = Date.now().toString(36);
const w = (rel, content) => { const f = path.join(OUT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); };
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
writeImages();
w("index.html", homePage("zh"));
w("en/index.html", homePage("en"));
for (const p of posts) { w(`post/${p.id}/index.html`, postPage(p, "zh")); w(`en/post/${p.id}/index.html`, postPage(p, "en")); }
w("404.html", notFoundPage());
w("rss.xml", rss("zh"));
w("en/rss.xml", rss("en"));
w("sitemap.xml", sitemap());
w("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`);
w("search.json", JSON.stringify(searchIndex()));
w(".nojekyll", "");
for (const f of ["styles.css", "app.js", "favicon.svg"]) fs.copyFileSync(path.join(HERE, f), path.join(OUT, f));
// prune images that no published post uses (drafts' images stay private)
const used = new Set();
for (const p of posts) { if (p.cover) used.add(p.cover); for (const m of `${p.bodyZh}\n${p.bodyEn}`.matchAll(/#img-([A-Za-z0-9_-]+)/g)) used.add(m[1]); }
for (const [id, ext] of Object.entries(imgExt)) if (!used.has(id)) { fs.rmSync(path.join(OUT, "img", `${id}.${ext}`)); delete imgExt[id]; }
console.log(JSON.stringify({ site: SITE_URL, posts: posts.length, images: Object.keys(imgExt).length, analytics: !!CF_TOKEN }));
