// 器材札記 Camera Notes — public site script: filters, search, read aloud
(() => {
  const lang = document.body.dataset.lang === "en" ? "en" : "zh";
  try { document.querySelectorAll("[data-lang-link]").forEach((a) => a.addEventListener("click", () => localStorage.setItem("cn-lang", a.dataset.langLink))); } catch (e) {}

  /* ---------- home: category / tag / search filters ---------- */
  const list = document.getElementById("list");
  if (list) {
    const cards = [...list.querySelectorAll(".card")];
    const bar = document.getElementById("filterbar"), nomatch = document.getElementById("nomatch"), q = document.getElementById("q");
    const catNames = JSON.parse(document.getElementById("catnames").textContent || "{}");
    const params = new URLSearchParams(location.search);
    const st = { cat: params.get("cat") || "", tag: params.get("tag") || "", q: params.get("q") || "" };
    let index = null, loading = null;
    const loadIndex = () => loading || (loading = fetch("/search.json").then((r) => r.json()).then((d) => { index = new Map(d.map((x) => [x.id, x.s])); }).catch(() => { index = new Map(); }));
    q.value = st.q;
    const chip = (text, onclick, on) => { const a = document.createElement("button"); a.type = "button"; a.className = "chip" + (on ? " on" : ""); a.textContent = text; a.onclick = onclick; return a; };
    function sync() {
      const p = new URLSearchParams();
      if (st.cat) p.set("cat", st.cat); if (st.tag) p.set("tag", st.tag); if (st.q) p.set("q", st.q);
      history.replaceState(null, "", location.pathname + (p.toString() ? "?" + p : ""));
    }
    async function apply() {
      const words = st.q.toLowerCase().split(/\s+/).filter(Boolean);
      if (words.length && !index) await loadIndex();
      let n = 0;
      for (const c of cards) {
        const tags = JSON.parse(c.dataset.tags || "[]");
        const ok = (!st.cat || c.dataset.cat === st.cat) && (!st.tag || tags.includes(st.tag)) &&
          (!words.length || words.every((w) => (index.get(c.dataset.id) || "").includes(w)));
        c.hidden = !ok; if (ok) n++;
      }
      nomatch.hidden = n > 0;
      const filtered = st.cat || st.tag || st.q;
      bar.hidden = !filtered; bar.innerHTML = "";
      if (filtered) {
        const lab = document.createElement("span"); lab.className = "label"; lab.textContent = bar.dataset.results.replace("{n}", n); bar.append(lab);
        if (st.cat) bar.append(chip((catNames[st.cat] || st.cat) + " ×", () => { st.cat = ""; update(); }, true));
        if (st.tag) bar.append(chip("#" + st.tag + " ×", () => { st.tag = ""; update(); }, true));
        if (st.q) bar.append(chip("“" + st.q + "” ×", () => { st.q = ""; q.value = ""; update(); }, true));
        bar.append(chip(bar.dataset.clear, () => { st.cat = st.tag = st.q = ""; q.value = ""; update(); }));
      }
      document.querySelectorAll("#catlist li").forEach((li) => li.classList.toggle("on", li.dataset.cat === st.cat));
      document.querySelectorAll("#tagcloud [data-tag]").forEach((a) => a.classList.toggle("on", a.dataset.tag === st.tag));
    }
    const update = () => { sync(); apply(); };
    document.addEventListener("click", (e) => {
      const a = e.target.closest("[data-filter-cat],[data-filter-tag],#catlist a,#tagcloud [data-tag]");
      if (!a) return;
      e.preventDefault();
      if (a.dataset.filterCat !== undefined) { st.cat = a.dataset.filterCat; st.tag = ""; }
      else if (a.dataset.filterTag !== undefined) { st.tag = a.dataset.filterTag; st.cat = ""; }
      else if (a.dataset.tag !== undefined) st.tag = st.tag === a.dataset.tag ? "" : a.dataset.tag;
      else st.cat = a.closest("li").dataset.cat || "";
      update(); window.scrollTo({ top: 0 });
    });
    let timer; q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { st.q = q.value.trim(); update(); }, 150); });
    q.addEventListener("focus", loadIndex, { once: true });
    const more = document.getElementById("moretags");
    if (more) more.onclick = () => { document.querySelectorAll("#tagcloud [data-more]").forEach((x) => (x.hidden = false)); more.remove(); };
    apply();
  }

  /* ---------- read aloud ---------- */
  const box = document.getElementById("tts");
  const prose = document.querySelector(".prose");
  if (!box || !prose || !("speechSynthesis" in window) || !window.SpeechSynthesisUtterance) return;
  const cl = box.dataset.lang === "en" ? "en" : "zh";
  const L = {
    zh: { listen: "▶ 朗讀文章", pause: "❚❚ 暫停", resume: "▶ 繼續", stop: "■ 停止", speed: "語速", playing: "朗讀中", paused: "已暫停", err: "此瀏覽器未能朗讀。" },
    en: { listen: "▶ Read aloud", pause: "❚❚ Pause", resume: "▶ Resume", stop: "■ Stop", speed: "Speed", playing: "Reading", paused: "Paused", err: "This browser cannot read aloud." },
  }[lang];
  const pref = (k, d) => { try { return localStorage.getItem("cn-tts-" + k) || d; } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem("cn-tts-" + k, v); } catch (e) {} };

  const mk = (tag, attrs = {}, text) => { const n = document.createElement(tag); Object.assign(n, attrs); if (text != null) n.textContent = text; return n; };
  const play = mk("button", { className: "btn small primary", type: "button" }, L.listen);
  const stop = mk("button", { className: "btn small", type: "button", hidden: true }, L.stop);
  const rate = mk("select", { ariaLabel: L.speed });
  ["0.8", "1", "1.2", "1.5"].forEach((r) => { const o = mk("option", { value: r }, r + "×"); if (pref("rate", "1") === r) o.selected = true; rate.append(o); });
  let dia = null;
  if (cl === "zh") {
    dia = mk("select", { ariaLabel: "讀音" });
    [["yue", "粵語"], ["cmn", "國語"]].forEach(([v, n]) => { const o = mk("option", { value: v }, n); if (pref("dialect", "yue") === v) o.selected = true; dia.append(o); });
  }
  const state = mk("span", { className: "state" }); state.setAttribute("aria-live", "polite");
  const spd = mk("span", { className: "label" }, L.speed);
  box.append(play, stop, ...(dia ? [dia] : []), spd, rate, state);
  box.hidden = false;

  const S = { active: false, paused: false, queue: [], idx: 0, cur: null, ut: null };
  const low = (v) => (v.lang || "").toLowerCase().replace("_", "-");
  function voice() {
    const vs = speechSynthesis.getVoices();
    const find = (pre) => pre.map((x) => vs.find((v) => low(v).startsWith(x))).find(Boolean);
    if (cl === "en") return find(["en-gb", "en-us", "en"]);
    return pref("dialect", "yue") === "yue" ? find(["zh-hk", "yue", "zh-tw", "zh"]) : find(["zh-tw", "zh-cn", "cmn", "zh"]);
  }
  function split(txt, max = 160) {
    const parts = (txt.match(/[^。！？!?；;.\n]+[。！？!?；;.]*[」』"')]*|\n/g) || []).map((s) => s.trim()).filter(Boolean);
    const out = []; let buf = "";
    for (const p of parts) {
      if ((buf + p).length > max && buf) { out.push(buf); buf = ""; }
      if (p.length > max) { for (let i = 0; i < p.length; i += max) out.push(p.slice(i, i + max)); }
      else buf += (buf && !/[　-鿿]$/.test(buf) ? " " : "") + p;
    }
    if (buf) out.push(buf);
    return out;
  }
  function ui() {
    play.textContent = !S.active ? L.listen : S.paused ? L.resume : L.pause;
    stop.hidden = !S.active;
    state.textContent = !S.active ? "" : S.paused ? L.paused : `${L.playing} ${Math.min(S.idx + 1, S.queue.length)}/${S.queue.length}`;
  }
  function halt() {
    S.active = false; S.paused = false; S.queue = []; S.idx = 0;
    if (S.ut) S.ut._skip = true;
    try { speechSynthesis.cancel(); } catch (e) {}
    if (S.cur) S.cur.classList.remove("reading");
    S.cur = null; ui();
  }
  function next() {
    if (!S.active) return;
    if (S.idx >= S.queue.length) return halt();
    const item = S.queue[S.idx];
    if (S.cur !== item.node) {
      if (S.cur) S.cur.classList.remove("reading");
      S.cur = item.node;
      if (item.node) {
        item.node.classList.add("reading");
        const r = item.node.getBoundingClientRect();
        if (r.top < 0 || r.bottom > innerHeight)
          item.node.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      }
    }
    const ut = new SpeechSynthesisUtterance(item.text);
    const v = voice();
    if (v) { ut.voice = v; ut.lang = v.lang; } else ut.lang = cl === "en" ? "en-GB" : pref("dialect", "yue") === "yue" ? "zh-HK" : "zh-TW";
    ut.rate = parseFloat(pref("rate", "1")) || 1;
    ut.onend = () => { if (!S.active || ut._skip) return; S.idx++; ui(); next(); };
    ut.onerror = (e) => { if (ut._skip || e.error === "interrupted" || e.error === "canceled") return; halt(); alertOnce(); };
    S.ut = ut; speechSynthesis.speak(ut); ui();
  }
  let warned = false;
  const alertOnce = () => { if (warned) return; warned = true; state.textContent = L.err; };
  function start() {
    halt();
    const title = document.querySelector(".article h1");
    const q = [{ text: title ? title.textContent.trim() : "", node: null }];
    prose.querySelectorAll("h2,h3,h4,p,li,figcaption,pre").forEach((n) => {
      const txt = (n.innerText || n.textContent || "").trim();
      if (txt) split(txt).forEach((c) => q.push({ text: c, node: n }));
    });
    S.queue = q.filter((x) => x.text); S.idx = 0; S.active = true; S.paused = false; next();
  }
  function restartCurrent() {
    if (!S.active) return;
    S.paused = false; const cur = S.idx;
    if (S.ut) S.ut._skip = true;
    try { speechSynthesis.cancel(); } catch (e) {}
    S.idx = cur; setTimeout(next, 60);
  }
  play.onclick = () => {
    if (!S.active) return start();
    if (S.paused) { S.paused = false; speechSynthesis.resume(); if (!speechSynthesis.speaking) next(); }
    else { S.paused = true; speechSynthesis.pause(); }
    ui();
  };
  stop.onclick = halt;
  rate.onchange = () => { save("rate", rate.value); restartCurrent(); };
  if (dia) dia.onchange = () => { save("dialect", dia.value); restartCurrent(); };
  try { speechSynthesis.getVoices(); } catch (e) {}
  addEventListener("pagehide", () => { try { speechSynthesis.cancel(); } catch (e) {} });
})();
