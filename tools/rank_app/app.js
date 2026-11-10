/* Ranking app. State lives in D (the draft); D.ranked's order IS the ranking. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const STARS = [5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5];
  const EXC = { 3: "Must listen", 2: "Somewhat hype", 1: "Take or leave" };
  const f1 = (v) => Number(v).toFixed(1);
  let D = null, YEAR = null, tab = "rank", lastSaved = "";

  async function api(path, body, headers = {}) {
    const res = await fetch(path, body === undefined ? {} : { method: "POST", body: body instanceof Blob || typeof body === "string" ? body : JSON.stringify(body), headers });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || `Request failed (${res.status})`);
    return j;
  }

  // ---------- autosave ----------
  let saveTimer = null;
  function dirty() {
    $("status").textContent = "Saving draft…";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try { await api("/api/draft", D); $("status").textContent = "Draft saved"; }
      catch (e) { $("status").textContent = "Couldn't save draft: " + e.message; }
    }, 500);
  }

  // ---------- screens ----------
  function show(which) {
    ["start", "editor", "done"].forEach((s) => { $(s).hidden = s !== which; });
    $("bar-ctl").hidden = which !== "editor";
  }

  async function init() {
    const st = await api("/api/state");
    YEAR = st.year;
    $("year-label").textContent = `· ${YEAR}`;
    if (st.draft) { load(st.draft); return; }
    show("start");
    const last = st.exports[st.exports.length - 1];
    $("or-existing").replaceChildren();
    if (last) {
      const b = h("button", "linkbtn", `start from the ${last} export already in the repo`);
      b.type = "button";
      b.onclick = async () => { try { load(await api("/api/start", { exportDate: last })); dirty(); } catch (e) { startErr(e); } };
      $("or-existing").append(document.createTextNode("Or "), b, document.createTextNode(" (to re-order or re-tag without new data)."));
    }
  }
  function startErr(e) { $("start-err").hidden = false; $("start-err").textContent = e.message; }

  async function importFile(file) {
    if (!file) return;
    $("start-err").hidden = true;
    try {
      const d = await api("/api/import", file, { "X-Filename": encodeURIComponent(file.name), "Content-Type": "text/csv" });
      load(d); dirty();
    } catch (e) { startErr(e); }
  }
  $("file").addEventListener("change", (e) => importFile(e.target.files[0]));
  const drop = $("drop");
  ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => importFile(e.dataTransfer.files[0]));

  function load(d) {
    D = d;
    $("date").value = D.date;
    $("genres").replaceChildren(...D.genres.map((g) => new Option(g)));
    show("editor");
    render();
  }

  // ---------- helpers ----------
  const tierOf = (st) => D.ranked.filter((a) => a.stars === st);
  function placeInTier(a, newStars) {
    const old = a.stars;
    D.ranked.splice(D.ranked.indexOf(a), 1);
    a.stars = newStars;
    const idx = D.ranked.map((x, i) => [x, i]).filter(([x]) => x.stars === newStars).map(([, i]) => i);
    let at;
    if (idx.length) at = newStars > old ? idx[idx.length - 1] + 1 : idx[0];  // up: bottom of tier; down: top
    else at = D.ranked.findIndex((x) => x.stars < newStars);
    if (at < 0) at = D.ranked.length;
    D.ranked.splice(at, 0, a);
  }
  // covers added in this app live in site/art/ and come back as "art/<file>"
  const artSrc = (u) => (!u ? "" : /^https?:/i.test(u) ? u : "/site/" + u);
  function coverImg(a, cls) {
    const c = h("span", cls);
    if (a.art) { const img = new Image(); img.src = artSrc(a.art); img.alt = ""; img.loading = "lazy"; img.referrerPolicy = "no-referrer"; img.onerror = () => img.remove(); c.append(img); }
    else c.textContent = (a.album || "?").trim().charAt(0).toUpperCase();
    return c;
  }
  function cover(a) {
    const b = h("button", "art" + (a.art ? "" : " no-art"));
    b.type = "button";
    b.title = a.art ? "Change cover art" : "Add cover art";
    b.setAttribute("aria-label", `${b.title}: ${a.album}`);
    b.append(...coverImg(a, "art-in").childNodes);
    b.addEventListener("click", () => Art.open([a]));
    b.addEventListener("mousedown", (e) => e.stopPropagation());
    return b;
  }
  function starSelect(value, withUnrated, onChange) {
    const s = h("select", "stars-sel");
    if (withUnrated) s.append(new Option("Unrated", ""));
    STARS.forEach((v) => s.append(new Option(`${f1(v)} ★`, String(v))));
    s.value = value == null ? "" : String(value);
    s.addEventListener("change", () => onChange(s.value === "" ? null : Number(s.value)));
    return s;
  }
  function toggle(label, cls, on, onChange) {
    const b = h("button", "vt " + cls);
    b.type = "button";
    b.setAttribute("aria-pressed", String(on));
    b.append(h("span", "dot"), document.createTextNode(label));
    b.addEventListener("click", () => { const v = b.getAttribute("aria-pressed") !== "true"; b.setAttribute("aria-pressed", String(v)); onChange(v); });
    return b;
  }

  // ---------- render ----------
  function render() {
    renderSummary();
    $("tab-rank").textContent = `Ranking (${D.ranked.length})`;
    $("tab-queue").textContent = `Queue (${D.queue.length})`;
    $("pane-rank").hidden = tab !== "rank";
    $("pane-queue").hidden = tab !== "queue";
    $("tab-rank").setAttribute("aria-selected", String(tab === "rank"));
    $("tab-queue").setAttribute("aria-selected", String(tab === "queue"));
    if (tab === "rank") renderTiers(); else renderQueue();
  }

  function renderSummary() {
    const news = D.ranked.filter((a) => a.prevRank == null).length;
    const rerated = D.ranked.filter((a) => a.prevStars != null && a.prevStars !== a.stars).length;
    const untagged = D.ranked.filter((a) => !a.genre.trim()).length;
    const chips = [
      [`${D.ranked.length} ranked`, ""],
      [`${news} new`, news ? "new" : ""],
      [`${rerated} with different stars than last time`, rerated ? "warn" : ""],
      [`${untagged} need a genre`, untagged ? "warn" : ""],
    ];
    const box = $("summary"); box.replaceChildren();
    const line = h("p", "sum-line");
    line.textContent = `From the ${D.exportDate} export${D.prevDate ? `, starting from your ${D.prevDate} ranking` : ""}.`;
    const cs = h("div", "chips");
    chips.forEach(([t, c]) => cs.append(h("span", "chip " + c, t)));
    box.append(line, cs);
    if (D.dropped && D.dropped.length) {
      const w = h("p", "err");
      w.textContent = `Not rated in this export, so left out: ${D.dropped.map((a) => `${a.artist} – ${a.album}`).join("; ")}. Rate it on RYM, or give it stars in the Queue tab.`;
      box.append(w);
    }
    const all = [...D.ranked, ...D.queue];
    const noArt = all.filter((a) => a.artState === "none");
    const pending = all.filter((a) => a.artState === "pending").length;
    if (noArt.length || pending) {
      const w = h("div", "art-line");
      const msg = [];
      if (noArt.length) msg.push(`${noArt.length} album${noArt.length === 1 ? " has" : "s have"} no cover art, and GitHub couldn't find ${noArt.length === 1 ? "one" : "them"}.`);
      if (pending) msg.push(`${pending} new album${pending === 1 ? " hasn't" : "s haven't"} been looked up yet; GitHub will try after you publish.`);
      w.append(h("span", null, msg.join(" ")));
      if (noArt.length) {
        const b = h("button", "btn small", "Add missing covers"); b.type = "button";
        b.onclick = () => Art.open(noArt, true);
        w.append(b);
      }
      box.append(w);
    }
    if (D.duplicates && D.duplicates.length) {
      box.append(h("p", "note-line", `Listed twice on RYM, showing one copy: ${D.duplicates.map((a) => `${a.artist} – ${a.album}`).join("; ")}.`));
    }
    if (D.ratedTwice && D.ratedTwice.length) {
      box.append(h("p", "warn-line", `Rated twice on RYM, so both copies are ranked: ${D.ratedTwice.map((a) => `${a.artist} – ${a.album}`).join("; ")}. Unrate one on RYM (or set one to Unrated here).`));
    }
    if (D.existingSnapshots.includes($("date").value)) {
      const w = h("p", "warn-line", `A ranking dated ${$("date").value} already exists. Saving will replace it.`);
      box.append(w);
    }
  }

  let dragId = null;
  function renderTiers() {
    const box = $("tiers"); box.replaceChildren();
    const tiers = [...new Set(D.ranked.map((a) => a.stars))].sort((a, b) => b - a);
    let n = 0;
    tiers.forEach((st) => {
      const items = tierOf(st);
      const sec = h("section", "tier");
      sec.append(h("h2", "tier-h", `${f1(st)} stars · ${items.length} album${items.length === 1 ? "" : "s"}`));
      const list = h("ol", "tier-list"); list.dataset.stars = st;
      items.forEach((a, k) => list.append(row(a, ++n, k, items.length)));
      list.addEventListener("dragover", (e) => {
        const dragging = list.querySelector(".dragging");
        if (!dragging) return;  // only within the same tier
        e.preventDefault();
        const after = [...list.querySelectorAll(".row:not(.dragging)")].find((r) => e.clientY < r.getBoundingClientRect().top + r.offsetHeight / 2);
        list.insertBefore(dragging, after || null);
      });
      list.addEventListener("drop", (e) => e.preventDefault());
      sec.append(list);
      box.append(sec);
    });
  }

  function row(a, n, k, size) {
    const li = h("li", "row" + (a.prevRank == null ? " is-new" : ""));
    li.dataset.id = a.id;
    const handle = h("span", "handle", "⋮⋮"); handle.title = "Drag to reorder";
    li.draggable = true;
    li.addEventListener("dragstart", (e) => { dragId = a.id; li.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(a.id)); });
    li.addEventListener("dragend", () => {
      li.classList.remove("dragging");
      const list = li.parentElement;
      const ids = [...list.querySelectorAll(".row")].map((r) => +r.dataset.id);
      const st = Number(list.dataset.stars);
      const start = D.ranked.findIndex((x) => x.stars === st);
      const byId = new Map(D.ranked.map((x) => [x.id, x]));
      D.ranked.splice(start, ids.length, ...ids.map((id) => byId.get(id)));
      dragId = null;
      render(); dirty();
    });

    const main = h("div", "main");
    const t = h("div", "title"); t.append(h("b", null, a.album), h("span", null, a.artist));
    const badges = h("div", "badges");
    if (a.prevRank == null) badges.append(h("span", "b new", "New"));
    else badges.append(h("span", "b", `was #${a.prevRank}`));
    if (a.prevStars != null && a.prevStars !== a.stars) badges.append(h("span", "b warn", `was ${f1(a.prevStars)}★`));
    if (a.rymStars != null && a.rymStars !== a.stars) badges.append(h("span", "b", `RYM says ${f1(a.rymStars)}★`));
    main.append(t, badges);

    const genre = h("input", "genre-in"); genre.type = "text"; genre.value = a.genre; genre.placeholder = "genre"; genre.setAttribute("list", "genres");
    if (!a.genre.trim()) genre.classList.add("missing");
    genre.addEventListener("input", () => { a.genre = genre.value; genre.classList.toggle("missing", !genre.value.trim()); dirty(); });
    genre.addEventListener("change", renderSummary);

    const vibes = h("div", "vibes");
    vibes.append(toggle("Artsy", "artsy", a.artsy, (v) => { a.artsy = v; dirty(); }), toggle("Aggressive", "aggr", a.aggressive, (v) => { a.aggressive = v; dirty(); }));

    const stars = starSelect(a.stars, true, (v) => {
      if (v == null) {  // back to the queue
        D.ranked.splice(D.ranked.indexOf(a), 1);
        a.stars = undefined;
        D.queue.unshift(a);
      } else placeInTier(a, v);
      render(); dirty();
    });

    const mv = h("div", "mv");
    const up = h("button", "icon", "↑"); up.type = "button"; up.disabled = k === 0; up.title = "Move up";
    const dn = h("button", "icon", "↓"); dn.type = "button"; dn.disabled = k === size - 1; dn.title = "Move down";
    const swap = (dir) => { const i = D.ranked.indexOf(a); [D.ranked[i], D.ranked[i + dir]] = [D.ranked[i + dir], D.ranked[i]]; render(); dirty(); };
    up.onclick = () => swap(-1); dn.onclick = () => swap(1);
    mv.append(up, dn);

    li.append(handle, h("span", "n", String(n)), cover(a), main, stars, genre, vibes, mv);
    return li;
  }

  function renderQueue() {
    const box = $("queue"); box.replaceChildren();
    if (!D.queue.length) { box.append(h("p", "hint", "Nothing in the queue.")); return; }
    const list = h("ul", "qlist");
    D.queue.forEach((a) => {
      const li = h("li", "qrow");
      const main = h("div", "main"); const t = h("div", "title"); t.append(h("b", null, a.album), h("span", null, a.artist)); main.append(t);
      const ex = h("div", "exc");
      [3, 2, 1].forEach((lvl) => {
        const b = h("button", "exc-b", EXC[lvl]); b.type = "button";
        b.setAttribute("aria-pressed", String(a.excitement === lvl));
        b.prepend(h("span", "pips", "●".repeat(lvl) + "○".repeat(3 - lvl)));
        b.onclick = () => { a.excitement = a.excitement === lvl ? null : lvl; renderQueue(); dirty(); };
        ex.append(b);
      });
      const rate = starSelect(null, true, (v) => {
        if (v == null) return;
        D.queue.splice(D.queue.indexOf(a), 1);
        a.stars = v; a.excitement = null;
        const at = D.ranked.findIndex((x) => x.stars < v);
        D.ranked.splice(at < 0 ? D.ranked.length : at, 0, a);  // bottom of its tier
        render(); dirty();
      });
      rate.title = "Give it stars to add it to the ranking";
      li.append(cover(a), main, ex, rate);
      list.append(li);
    });
    box.append(list);
  }

  // ---------- cover art ----------
  const Art = (() => {
    const dlg = $("art-dlg");
    let list = [], i = 0, walk = false, busy = false;

    function open(items, walkthrough = false) {
      list = items.slice(); i = 0; walk = walkthrough;
      if (!list.length) return;
      show();
      if (!dlg.open) dlg.showModal();
    }
    function cur() { return list[i]; }
    function show() {
      const a = cur();
      $("art-title").textContent = a.album;
      $("art-artist").textContent = a.artist;
      $("art-step").textContent = walk ? `${i + 1} of ${list.length}` : "";
      $("art-preview").replaceChildren(...coverImg(a, "x").childNodes);
      $("art-preview").classList.toggle("empty", !a.art);
      $("art-state").textContent = { manual: "Your cover", auto: "Found automatically", none: "No cover yet", pending: "Not looked up yet" }[a.artState] || "";
      $("art-url").value = "";
      $("art-msg").textContent = ""; $("art-msg").className = "art-msg";
      $("art-remove").hidden = a.artState !== "manual";
      $("art-skip").hidden = !walk || i === list.length - 1;
      $("art-close").textContent = walk ? (i === list.length - 1 ? "Done" : "Stop here") : "Close";
      const q = encodeURIComponent(`${a.artist} ${a.album}`);
      $("art-bc").href = `https://bandcamp.com/search?q=${q}`;
      $("art-gi").href = `https://www.google.com/search?tbm=isch&q=${q}`;
    }
    function msg(t, cls = "") { $("art-msg").textContent = t; $("art-msg").className = "art-msg " + cls; }
    function next() { if (i < list.length - 1) { i++; show(); } else dlg.close(); }

    // Shrink to at most 800px on the long side and save as JPEG, so covers stay small in the repo.
    async function toJpeg(blob) {
      let bmp;
      try { bmp = await createImageBitmap(blob); }
      catch { throw new Error("Couldn't read that as an image."); }
      const k = Math.min(1, 800 / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas");
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      const g = c.getContext("2d");
      g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);  // transparent PNGs
      g.drawImage(bmp, 0, 0, c.width, c.height);
      return { jpg: await new Promise((r) => c.toBlob(r, "image/jpeg", 0.9)), w: bmp.width, h: bmp.height };
    }
    function apply(id, res) {
      [...D.ranked, ...D.queue].forEach((x) => { if (x.id === id) Object.assign(x, res); });
      render(); dirty();
    }
    async function useBlob(blob) {
      if (busy) return;
      const a = cur();
      busy = true; msg("Saving…");
      try {
        const { jpg, w, h: ht } = await toJpeg(blob);
        const res = await api("/api/art", jpg, { "X-Rym-Id": String(a.id), "Content-Type": "image/jpeg" });
        apply(a.id, res);
        const small = Math.max(w, ht) < 300 ? ` It's only ${w}×${ht}, so it may look soft on the dashboard.` : "";
        if (walk && i < list.length - 1) { next(); msg(`Saved the cover for ${a.album}.${small}`, small ? "warn" : "ok"); }
        else { show(); msg(`Saved.${small}`, small ? "warn" : "ok"); }
      } catch (e) { msg(e.message, "bad"); }
      busy = false;
    }
    async function useUrl(u) {
      u = (u || "").trim();
      if (!u) return;
      msg("Downloading…");
      try {
        const res = await fetch("/api/fetch-image?url=" + encodeURIComponent(u));
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Download failed (${res.status})`);
        await useBlob(await res.blob());
      } catch (e) { msg(e.message, "bad"); }
    }

    const drop = $("art-drop");
    ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
    drop.addEventListener("drop", (e) => {
      const f = [...e.dataTransfer.files].find((x) => x.type.startsWith("image/"));
      if (f) return useBlob(f);
      const u = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");  // image dragged from another tab
      if (u) useUrl(u.split("\n")[0]);
    });
    $("art-file").addEventListener("change", (e) => { if (e.target.files[0]) useBlob(e.target.files[0]); e.target.value = ""; });
    dlg.addEventListener("paste", (e) => {
      const f = [...e.clipboardData.files].find((x) => x.type.startsWith("image/"));
      if (f) { e.preventDefault(); useBlob(f); return; }
      if (e.target === $("art-url")) return;  // let the paste land, then they press Get
      const t = e.clipboardData.getData("text").trim();
      if (/^https?:\/\//i.test(t)) { e.preventDefault(); $("art-url").value = t; useUrl(t); }
    });
    $("art-get").onclick = () => useUrl($("art-url").value);
    $("art-url").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); useUrl($("art-url").value); } });
    $("art-skip").onclick = () => next();
    $("art-close").onclick = () => dlg.close();
    $("art-remove").onclick = async () => {
      const a = cur();
      try { apply(a.id, await api("/api/art-delete", { id: a.id })); show(); msg("Removed your cover.", "ok"); }
      catch (e) { msg(e.message, "bad"); }
    };
    return { open };
  })();

  // ---------- top bar ----------
  $("tab-rank").onclick = () => { tab = "rank"; render(); };
  $("tab-queue").onclick = () => { tab = "queue"; render(); };
  $("date").addEventListener("change", () => { D.date = $("date").value; renderSummary(); dirty(); });
  $("discard").onclick = async () => {
    if (!confirm("Throw away this draft and start over? Nothing saved to the repo is affected.")) return;
    await api("/api/discard", {}); D = null; init();
  };
  $("save").onclick = async () => {
    const d = $("date").value;
    if (D.existingSnapshots.includes(d) && !confirm(`Replace the existing ${d} ranking?`)) return;
    $("save").disabled = true;
    try {
      const r = await api("/api/save", { date: d, ranked: D.ranked, queue: D.queue });
      $("done-msg").textContent = `${r.count} albums saved to ${r.path}.` + (r.untagged ? ` ${r.untagged} still need a genre; you can fill those in later.` : "");
      $("log").hidden = true;
      lastSaved = d;
      D = null;
      show("done");
    } catch (e) { alert("Couldn't save: " + e.message); }
    $("save").disabled = false;
  };
  $("publish").onclick = async () => {
    $("publish").disabled = true; $("publish").textContent = "Publishing…";
    try {
      const r = await api("/api/publish", { date: lastSaved });
      $("log").hidden = false; $("log").textContent = (r.ok ? "Published. The site updates in a couple of minutes.\n\n" : "Something went wrong. Details:\n\n") + r.log;
    } catch (e) { $("log").hidden = false; $("log").textContent = e.message; }
    $("publish").disabled = false; $("publish").textContent = "Publish to GitHub";
  };
  $("again").onclick = () => init();

  init().catch((e) => { show("start"); startErr(e); });
})();
