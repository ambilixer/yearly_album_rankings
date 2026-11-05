/* Best Albums dashboard. Reads data/<year>.json written by tools/build.py. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fmtDate = (d) => { const [, m, day] = d.split("-"); return `${MONTHS[+m - 1]} ${+day}`; };
  const fmtStars = (s) => s.toFixed(1);
  const fmtRel = (a) => (a.releasedSource === "estimate" ? "~" : "") + fmtLong(a.released);
  const fmtLong = (d) => { const [y, m, day] = d.split("-"); return day ? `${MONTHS[+m - 1]} ${+day}, ${y}` : m ? `${MONTHS[+m - 1]} ${y}` : y; };
  const qs = new URLSearchParams(location.search);

  const S = {
    data: null, byId: new Map(), snaps: [], si: 0,
    bump: "10", q: "", artsy: "any", aggr: "any",
  };

  // ---------- theme ----------
  const root = document.documentElement;
  try { const t = localStorage.getItem("theme"); if (t) root.dataset.theme = t; } catch (e) { /* storage blocked */ }
  $("theme").addEventListener("click", () => {
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("theme", root.dataset.theme); } catch (e) { /* ignore */ }
  });

  // ---------- tooltip ----------
  const tip = $("tip");
  function showTip(ev, rows) {
    tip.replaceChildren(...rows.map(([cls, text]) => h("div", cls, text)));
    tip.hidden = false;
    const pad = 14, w = tip.offsetWidth, ht = tip.offsetHeight;
    let x = ev.clientX + pad, y = ev.clientY + pad;
    if (x + w > innerWidth - 8) x = ev.clientX - pad - w;
    if (y + ht > innerHeight - 8) y = ev.clientY - pad - ht;
    tip.style.left = Math.max(8, x) + "px";
    tip.style.top = Math.max(8, y) + "px";
  }
  const hideTip = () => { tip.hidden = true; };
  addEventListener("scroll", hideTip, { passive: true });
  function albumTip(a, extra = []) {
    const s = snap(), r = a.ranks[s];
    const rows = [["tt", a.album], ["ts", a.artist]];
    const bits = [];
    if (r) bits.push(`#${r}`);
    if (a.stars[s] != null) bits.push(`${fmtStars(a.stars[s])} stars`);
    if (a.genre) bits.push(a.genre);
    if (bits.length) rows.push(["tn", bits.join(" · ")]);
    if (a.released) rows.push(["ts", `Released ${fmtRel(a)}`]);
    const v = [a.artsy && "Artsy", a.aggressive && "Aggressive"].filter(Boolean).join(" · ");
    if (v) rows.push(["ts", v]);
    return rows.concat(extra);
  }
  function bindTip(el, rowsFn) {
    el.addEventListener("pointermove", (ev) => showTip(ev, rowsFn()));
    el.addEventListener("pointerleave", hideTip);
    el.addEventListener("pointerdown", (ev) => showTip(ev, rowsFn()));
  }
  document.addEventListener("pointerdown", (ev) => { if (!ev.target.closest(".cover, svg, .topster-cell")) hideTip(); });

  // ---------- helpers on the data ----------
  const snap = () => S.snaps[S.si];
  const prevSnap = () => (S.si > 0 ? S.snaps[S.si - 1] : null);
  const ranked = (s = snap()) => S.data.albums.filter((a) => a.ranks[s] != null).sort((x, y) => x.ranks[s] - y.ranks[s]);
  const debutIdx = (a) => S.snaps.findIndex((s) => a.ranks[s] != null);

  function move(a, i = S.si) {
    const s = S.snaps[i], p = i > 0 ? S.snaps[i - 1] : null;
    if (a.ranks[s] == null || !p) return null;
    if (a.ranks[p] == null) return debutIdx(a) === i ? { kind: "new" } : null;  // a return shouldn't happen (ratings aren't removed)
    const d = a.ranks[p] - a.ranks[s];
    return { kind: d > 0 ? "up" : d < 0 ? "down" : "flat", d };
  }
  // Places gained among albums ranked in BOTH updates: strips out the push-down
  // effect of new entries. Returns null if the album isn't in both.
  const relCache = new Map();
  function relMove(a, i0, i1) {
    if (i0 < 0) return null;
    const key = i0 + ":" + i1;
    let m = relCache.get(key);
    if (!m) {
      const s0 = S.snaps[i0], s1 = S.snaps[i1];
      const both = S.data.albums.filter((x) => x.ranks[s0] != null && x.ranks[s1] != null);
      const pos = (s) => new Map([...both].sort((p, q) => p.ranks[s] - q.ranks[s]).map((x, k) => [x.id, k]));
      const p0 = pos(s0), p1 = pos(s1);
      m = new Map(both.map((x) => [x.id, p0.get(x.id) - p1.get(x.id)]));
      relCache.set(key, m);
    }
    return m.has(a.id) ? m.get(a.id) : null;
  }
  function heat(a, i = S.si) {
    const s = S.snaps[i], r = a.ranks[s];
    if (r == null) return null;
    const di = debutIdx(a);
    if (i - di <= 1 && r <= 10) return "Hot debut";
    // Surging / Slipping use real reordering only (new entries landing above don't count),
    // and the latest step must point the same way.
    const from = Math.max(di, i - 2);
    if (from < i) {
      const d = relMove(a, from, i), last = relMove(a, i - 1, i);
      if (d != null && d >= 5 && (last ?? 0) >= 0) return "Surging";
      if (d != null && d <= -5 && (last ?? 0) <= 0) return "Slipping";
    }
    const span = S.snaps.slice(di, i + 1);
    if (span.length >= 4 && span.every((x) => a.ranks[x] != null && a.ranks[x] <= 10)) return "Staple";
    return null;
  }
  function moveBadge(m) {
    if (!m) return h("span", "badge flat", "·");
    if (m.kind === "new") return h("span", "badge new", "New");
    if (m.kind === "flat") return h("span", "badge flat", "–");
    const b = h("span", "badge " + m.kind, (m.kind === "up" ? "▲" : "▼") + Math.abs(m.d));
    b.setAttribute("aria-label", `${m.kind === "up" ? "up" : "down"} ${Math.abs(m.d)} places`);
    return b;
  }
  const HEAT = {
    "Hot debut": ["hot", "✦", "Arrived in the last two updates and went straight to the top 10"],
    "Surging": ["surge", "↗", "Passed 5+ albums that were already on the list over the last three updates"],
    "Slipping": ["slip", "↘", "Passed by 5+ albums that were already on the list over the last three updates"],
    "Staple": ["staple", "◆", "Top 10 in every update since it arrived (at least four)"],
  };
  function heatBadge(name) {
    const [cls, icon] = HEAT[name];
    const b = h("span", "badge heat " + cls);
    b.append(h("span", "bi", icon), document.createTextNode(name));
    return b;
  }
  function starsEl(v) {
    const wrap = h("span");
    const s = h("span", "stars"); s.setAttribute("aria-label", `${fmtStars(v)} out of 5 stars`);
    const fill = h("span"); fill.style.width = (v / 5) * 100 + "%"; s.append(fill);
    wrap.append(s, h("span", "stars-n", fmtStars(v)));
    return wrap;
  }
  function vibeChips(a) {
    const box = h("span", "r-vibe");
    if (a.artsy) { const c = h("span", "chip"); c.append(h("span", "dot artsy"), document.createTextNode("Artsy")); box.append(c); }
    if (a.aggressive) { const c = h("span", "chip"); c.append(h("span", "dot aggr"), document.createTextNode("Aggressive")); box.append(c); }
    return box;
  }

  // deterministic placeholder art (decorative only)
  function hash(n) { let x = n | 0; x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); return (x ^ (x >>> 16)) >>> 0; }
  function cover(a, tiny = false, bare = false) {
    const c = h("div", "cover" + (tiny ? " tiny" : ""));
    if (a.art) {
      const img = new Image(); img.alt = `${a.album} cover`; img.loading = "lazy"; img.decoding = "async"; img.referrerPolicy = "no-referrer";
      img.onerror = () => { const alt = cover({ ...a, art: null }, tiny, bare); c.replaceWith(alt); };
      img.src = a.art;
      c.append(img);
      return c;
    }
    const k = hash(a.id), h1 = k % 360, h2 = (h1 + 30 + ((k >>> 9) % 90)) % 360, ang = (k >>> 3) % 180;
    const l1 = 0.42 + ((k >>> 12) % 18) / 100, l2 = 0.22 + ((k >>> 17) % 12) / 100;
    const g = h("div", "cover-gen");
    g.style.background = `radial-gradient(circle at ${20 + (k % 60)}% ${15 + ((k >>> 5) % 50)}%, oklch(${l1 + 0.12} 0.11 ${h1} / .9), transparent 55%), linear-gradient(${ang}deg, oklch(${l1} 0.09 ${h1}), oklch(${l2} 0.07 ${h2}))`;
    if (!bare) g.append(h("div", "cg-t", tiny ? (a.album.trim()[0] || "?").toUpperCase() : a.album), h("div", "cg-a", a.artist));
    g.setAttribute("aria-hidden", "true");
    c.append(g);
    c.setAttribute("role", "img"); c.setAttribute("aria-label", `${a.album} by ${a.artist}`);
    return c;
  }

  // rank sparkline up to the selected update
  function spark(a, w = 140, ht = 34) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("class", "spark"); svg.setAttribute("width", w); svg.setAttribute("height", ht);
    svg.setAttribute("viewBox", `0 0 ${w} ${ht}`); svg.setAttribute("aria-hidden", "true");
    const pts = S.snaps.slice(0, S.si + 1).map((s, i) => ({ i, r: a.ranks[s] }));
    const worst = Math.max(10, d3.max(pts, (p) => p.r || 0));
    const x = d3.scalePoint(d3.range(S.si + 1), [4, w - 4]);
    if (S.si === 0) x.range([w / 2, w / 2]);
    const y = d3.scaleLinear([1, worst], [4, ht - 4]);
    const sel = d3.select(svg);
    if (worst > 10) sel.append("line").attr("class", "sref").attr("x1", 0).attr("x2", w).attr("y1", y(10)).attr("y2", y(10));
    const line = d3.line().defined((p) => p.r != null).x((p) => x(p.i)).y((p) => y(p.r)).curve(d3.curveMonotoneX);
    sel.append("path").attr("class", "sl").attr("d", line(pts));
    const last = pts[pts.length - 1];
    if (last.r != null) sel.append("circle").attr("class", "sd").attr("cx", x(last.i)).attr("cy", y(last.r)).attr("r", 3.5);
    // lone points (debuts or re-entries without a neighbor) still need a mark
    pts.forEach((p, i) => {
      if (p.r != null && p !== last && (pts[i - 1]?.r == null) && (pts[i + 1]?.r == null))
        sel.append("circle").attr("cx", x(p.i)).attr("cy", y(p.r)).attr("r", 2).attr("fill", "var(--ink-2)");
    });
    return svg;
  }

  // ---------- hero ----------
  function renderHero() {
    const s = snap(), list = ranked(), a = list[0];
    $("title").innerHTML = "";
    $("title").append(document.createTextNode("Best albums of "), h("em", null, String(S.data.year)));
    document.title = `Best Albums of ${S.data.year}`;
    const latest = S.si === S.snaps.length - 1;
    $("lede").textContent = latest
      ? `My favorite releases of ${S.data.year}, ranked. Last updated ${fmtLong(s)}.`
      : `My favorite releases of ${S.data.year}, ranked. You're looking at the list as it stood on ${fmtLong(s)}; the latest update is ${fmtLong(S.snaps[S.snaps.length - 1])}.`;
    const n1 = $("n1"); n1.replaceChildren();
    if (a) {
      const right = h("div");
      const meta = h("div", "n1-meta");
      meta.append(starsEl(a.stars[s]));
      if (a.genre) meta.append(h("span", "genre", a.genre));
      meta.append(vibeChips(a));
      const prevNo1 = S.si > 0 ? ranked(S.snaps[S.si - 1])[0] : null;
      const atTop = S.snaps.slice(0, S.si + 1).filter((x) => a.ranks[x] === 1).length;
      const tag = prevNo1 && prevNo1.id !== a.id ? `New #1 · took over from ${prevNo1.artist}'s ${prevNo1.album}` : `#1 · on top in ${atTop} of ${S.si + 1} update${S.si ? "s" : ""}`;
      right.append(h("div", "n1-tag", tag), h("div", "n1-title", a.album), h("div", "n1-artist", a.artist), meta);
      n1.append(cover(a), right);
    }
    const tier1 = list.filter((x) => x.stars[s] >= 4).length;
    const queue = S.data.unrated.length;
    const debuts = list.filter((x) => move(x)?.kind === "new").length;
    const tiles = [
      [list.length, "albums ranked", S.si ? `${list.length - S.data.snapshotSizes[S.snaps[S.si - 1]] >= 0 ? "+" : ""}${list.length - S.data.snapshotSizes[S.snaps[S.si - 1]]} since ${fmtDate(S.snaps[S.si - 1])}` : "first update"],
      [tier1, "rated 4 stars or more", `${Math.round((tier1 / Math.max(1, list.length)) * 100)}% of the list`],
      [debuts, "new since last update", S.si ? `previous update ${fmtDate(S.snaps[S.si - 1])}` : "everything is new"],
      [queue, "in the queue", "saved, not rated yet"],
    ];
    $("tiles").replaceChildren(...tiles.map(([v, l, sub]) => {
      const t = h("div", "tile"); t.append(h("div", "tile-v", String(v)), h("div", "tile-l", l), h("div", "tile-s", sub)); return t;
    }));
  }

  // ---------- top 10 ----------
  function renderTop10() {
    const s = snap();
    const rows = ranked().slice(0, 10).map((a) => {
      const row = h("div", "t10");
      const main = h("div", "t10-main");
      main.append(h("div", "t10-title", a.album), h("div", "t10-artist", a.artist));
      const meta = h("div", "t10-meta");
      meta.append(starsEl(a.stars[s]));
      if (a.genre) meta.append(h("span", "genre", a.genre));
      meta.append(vibeChips(a));
      main.append(meta);
      if (a.released) main.append(h("div", "t10-rel", `Released ${fmtRel(a)}`));
      const sp = h("div", "t10-spark");
      const best = d3.min(S.snaps.slice(0, S.si + 1), (x) => a.ranks[x]);
      sp.append(spark(a), h("span", "cap", `debut #${a.ranks[S.snaps[debutIdx(a)]]} ${fmtDate(S.snaps[debutIdx(a)])} · best #${best}`));
      const mv = h("div", "t10-move");
      mv.append(moveBadge(move(a)));
      const ht = heat(a);
      if (ht) mv.append(heatBadge(ht));
      const c = cover(a);
      bindTip(c, () => albumTip(a));
      row.append(h("div", "t10-rank", String(a.ranks[s])), c, main, sp, mv);
      return row;
    });
    $("top10-list").replaceChildren(...rows);
  }

  // ---------- topster ----------
  function renderTopster() {
    const s = snap(), list = ranked().slice(0, 25);
    $("topster").replaceChildren(...list.map((a) => {
      const cell = h("div", "topster-cell");
      const info = h("div", "ts-info");
      const st = h("div", "ts-stars");
      const bar = h("span", "stars light"); const fill = h("span"); fill.style.width = (a.stars[s] / 5) * 100 + "%"; bar.append(fill);
      st.append(bar, h("span", "ts-num", fmtStars(a.stars[s])));
      info.append(st);
      if (a.genre) info.append(h("div", "ts-genre", a.genre));
      const vibes = h("div", "ts-vibes");
      if (a.artsy) { const v = h("span", "ts-v"); v.append(h("span", "dot artsy"), h("span", "ts-vl", "Artsy")); vibes.append(v); }
      if (a.aggressive) { const v = h("span", "ts-v"); v.append(h("span", "dot aggr"), h("span", "ts-vl", "Aggressive")); vibes.append(v); }
      if (vibes.childElementCount) info.append(vibes);
      cell.append(cover(a, false, true), info, h("span", "topster-n", String(a.ranks[s])));
      cell.setAttribute("aria-label", `#${a.ranks[s]} ${a.album} by ${a.artist}`);
      bindTip(cell, () => [["tt", a.album], ["ts", a.artist]].concat(a.released ? [["ts", `Released ${fmtRel(a)}`]] : []));
      return cell;
    }));
    $("topster-legend").replaceChildren(...list.map((a) => {
      const sp = h("span"); sp.append(h("b", null, String(a.ranks[s])), document.createTextNode(`${a.artist} – ${a.album}`)); sp.title = `${a.artist} – ${a.album}`; return sp;
    }));
  }

  // ---------- bump chart ----------
  function renderBump() {
    const box = $("bump");
    const W = Math.floor(box.clientWidth);
    if (!W) return;
    const narrow = W < 640;
    const cur = ranked();
    const scope = S.bump === "all" ? cur : cur.slice(0, +S.bump);
    const shownIds = new Set(scope.map((a) => a.id));
    const hlIds = new Set(cur.slice(0, 10).map((a) => a.id));
    const albums = S.bump === "all" ? S.data.albums.filter((a) => Object.keys(a.ranks).length) : scope;
    const maxR = d3.max(albums, (a) => d3.max(Object.values(a.ranks))) || 10;
    const labW = narrow ? 8 : 230;
    const m = { top: 26, right: labW, bottom: 14, left: 34 };
    const rowPx = S.bump === "10" ? 14 : 9;
    const H = Math.max(300, Math.min(maxR * rowPx, 900)) + m.top + m.bottom;
    const x = d3.scalePoint(S.snaps, [m.left, W - m.right]).padding(0.05);
    const y = d3.scaleLinear([1, maxR], [m.top, H - m.bottom]);
    const svg = d3.create("svg").attr("width", "100%").attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img")
      .attr("aria-label", "Bump chart of album ranks across updates");
    box.replaceChildren(svg.node());

    // axes
    const yt = y.ticks(Math.min(10, Math.floor((H - m.top - m.bottom) / 40))).filter((t) => Number.isInteger(t));
    if (!yt.includes(1)) yt.unshift(1);
    svg.append("g").selectAll("line").data(yt).join("line").attr("class", "c-grid").attr("x1", m.left).attr("x2", W - m.right).attr("y1", y).attr("y2", y);
    svg.append("g").selectAll("text").data(yt).join("text").attr("class", "c-tick").attr("x", m.left - 10).attr("y", y).attr("dy", "0.32em").attr("text-anchor", "end").text((t) => "#" + t);
    const every = narrow ? Math.ceil(S.snaps.length / 4) : 1;
    svg.append("g").selectAll("text").data(S.snaps).join("text").attr("class", "c-tick").attr("x", x).attr("y", 12).attr("text-anchor", "middle")
      .text((d, i) => (i % every === 0 || i === S.snaps.length - 1 ? fmtDate(d) : ""));
    svg.append("line").attr("class", "c-now").attr("x1", x(snap())).attr("x2", x(snap())).attr("y1", m.top - 6).attr("y2", H - m.bottom);

    const line = d3.line().defined((d) => d.r != null).x((d) => x(d.s)).y((d) => y(d.r)).curve(d3.curveMonotoneX);
    const series = albums.map((a) => ({ a, pts: S.snaps.map((s) => ({ s, r: a.ranks[s] })) }));
    // draw background first, highlighted last
    series.sort((p, q) => (hlIds.has(p.a.id) - hlIds.has(q.a.id)) || ((q.a.ranks[snap()] ?? 999) - (p.a.ranks[snap()] ?? 999)));
    const g = svg.append("g");
    const groups = g.selectAll("g").data(series).join("g").attr("data-id", (d) => d.a.id);
    groups.append("path").attr("class", (d) => "bump-line" + (hlIds.has(d.a.id) ? " hl" : "")).attr("d", (d) => line(d.pts));
    groups.selectAll("circle").data((d) => d.pts.filter((p) => p.r != null).map((p) => ({ ...p, a: d.a }))).join("circle")
      .attr("class", (d) => "bump-dot" + (hlIds.has(d.a.id) ? " hl" : "")).attr("cx", (d) => x(d.s)).attr("cy", (d) => y(d.r)).attr("r", (d) => (hlIds.has(d.a.id) ? 3 : 2.5));

    // right-edge labels for the current top 10
    const labs = svg.append("g");
    if (!narrow) {
      const last = S.snaps[S.snaps.length - 1];
      // stack labels 14px apart, drawing a short leader where a label had to move
      const items = cur.slice(0, 10).filter((a) => a.ranks[last] != null).map((a) => ({ a, y0: y(a.ranks[last]) }));
      items.forEach((it, k) => { it.y = k ? Math.max(it.y0, items[k - 1].y + 14) : it.y0; });
      const over = items.length ? items[items.length - 1].y - (H - m.bottom) : 0;
      if (over > 0) items.forEach((it) => { it.y -= over; });
      items.forEach(({ a, y0, y: yy }) => {
        labs.append("path").attr("data-id", a.id).attr("d", `M${W - m.right + 2},${y0} L${W - m.right + 6},${y0} L${W - m.right + 8},${yy}`).attr("fill", "none").attr("stroke", "var(--axis)");
        const t = labs.append("text").attr("class", "c-lab").attr("data-id", a.id).attr("x", W - m.right + 10).attr("y", yy).attr("dy", "0.32em");
        t.append("tspan").attr("font-weight", 600).text(a.ranks[last] + "  ");
        t.append("tspan").text(a.album);
        while (t.node().getComputedTextLength() > labW - 14 && t.select("tspan:last-child").text().length > 3) {
          const sp = t.select("tspan:last-child"); sp.text(sp.text().slice(0, -2).trimEnd() + "…");
        }
      });
    }

    // legend
    $("bump-legend").replaceChildren(...[["var(--ink)", "Current top 10"], ["var(--axis)", S.bump === "all" ? "Everything else ranked this year" : "Rest of the current top " + S.bump], ["var(--s-blue)", "Hovered"]].map(([c, t]) => {
      const k = h("span", "k"); const ln = h("span", "ln"); ln.style.background = c; k.append(ln, document.createTextNode(t)); return k;
    }));

    // hover: nearest point
    const pts = series.flatMap((d) => d.pts.filter((p) => p.r != null).map((p) => ({ ...p, a: d.a })));
    const del = d3.Delaunay.from(pts, (p) => x(p.s), (p) => y(p.r));
    const setHot = (id) => {
      svg.classed("dim", id != null);
      groups.each(function (d) { const on = d.a.id === id; d3.select(this).selectAll("path,circle").classed("hot", on); if (on) this.parentNode.appendChild(this); });
      labs.selectAll("text").classed("hot", function () { return +this.dataset.id === id; });
    };
    svg.append("rect").attr("x", m.left - 10).attr("y", 0).attr("width", W - m.left - m.right + 20).attr("height", H).attr("fill", "transparent")
      .on("pointermove pointerdown", (ev) => {
        const [mx, my] = d3.pointer(ev);
        const p = pts[del.find(mx, my)];
        if (!p || Math.hypot(x(p.s) - mx, y(p.r) - my) > 24) { setHot(null); hideTip(); return; }
        setHot(p.a.id);
        const hist = S.snaps.map((s) => (p.a.ranks[s] != null ? `${fmtDate(s)} #${p.a.ranks[s]}` : null)).filter(Boolean);
        showTip(ev, [["tt", p.a.album], ["ts", p.a.artist], ["tn", `${fmtDate(p.s)}: #${p.r} · ${fmtStars(p.a.stars[p.s])} stars`], ["ts", hist.join(" → ")]]);
      })
      .on("pointerleave", () => { setHot(null); hideTip(); });
    if (!shownIds.size) svg.append("text").attr("class", "c-title").attr("x", W / 2).attr("y", H / 2).attr("text-anchor", "middle").text("Nothing ranked yet.");
  }

  // ---------- full ranking table ----------
  function renderTable() {
    const s = snap(), all = ranked();
    const q = S.q.trim().toLowerCase();
    const want = (flag, v) => v === "any" || (v === "yes") === flag;
    const rows = all.filter((a) => (!q || `${a.artist} ${a.album} ${a.genre}`.toLowerCase().includes(q)) && want(a.artsy, S.artsy) && want(a.aggressive, S.aggr));
    $("rank-count").textContent = rows.length === all.length ? `${all.length} albums` : `${rows.length} of ${all.length} albums match`;
    renderPills();
    const body = $("rank-body"); body.replaceChildren();
    let tier = null;
    rows.forEach((a) => {
      const st = a.stars[s];
      if (st !== tier) {
        tier = st;
        const tr = h("tr", "tier-row"); const td = h("td"); td.colSpan = 8;
        const nt = all.filter((x) => x.stars[s] === st).length;
        td.textContent = `${fmtStars(st)} stars · ${nt} album${nt === 1 ? "" : "s"}`;
        tr.append(td); body.append(tr);
      }
      const tr = h("tr");
      const td = (cls, ...kids) => { const c = h("td", cls); c.append(...kids); return c; };
      const alb = h("div", "r-alb"); const c = cover(a, true); bindTip(c, () => albumTip(a));
      const nm = h("div"); nm.append(h("b", null, a.album), h("span", null, a.artist)); alb.append(c, nm);
      const mv = h("div"); mv.style.display = "flex"; mv.style.gap = "4px"; mv.style.flexWrap = "wrap";
      mv.append(moveBadge(move(a))); const ht = heat(a); if (ht) mv.append(heatBadge(ht));
      const prev = prevSnap();
      const stCell = h("div"); stCell.append(starsEl(st));
      if (prev && a.stars[prev] != null && a.stars[prev] !== st) {
        const up = st > a.stars[prev];
        const b = h("span", "badge " + (up ? "up" : "down"), `${up ? "+" : "−"}${Math.abs(st - a.stars[prev]).toFixed(1)}`);
        b.title = `was ${fmtStars(a.stars[prev])} on ${fmtDate(prev)}`; b.style.marginLeft = "6px"; stCell.append(b);
      }
      const di = debutIdx(a);
      tr.append(
        td("r-n", document.createTextNode(String(a.ranks[s]))), td(null, mv), td(null, alb), td(null, stCell),
        td("hide-sm genre", document.createTextNode(a.genre || "")), td(null, vibeChips(a)),
        td("hide-sm", spark(a, 110, 28)), td("hide-sm r-debut", document.createTextNode(`#${a.ranks[S.snaps[di]]} · ${fmtDate(S.snaps[di])}`)),
      );
      body.append(tr);
    });
    if (!rows.length) { const tr = h("tr"); const c = h("td", "empty", "Nothing matches these filters."); c.colSpan = 8; tr.append(c); body.append(tr); }
  }

  // ---------- movers: slope chart ----------
  function relax(items, gap, lo, hi) {
    items.sort((p, q) => p.y0 - q.y0);
    items.forEach((it, k) => { it.y = k ? Math.max(it.y0, items[k - 1].y + gap) : Math.max(lo, it.y0); });
    const over = items.length ? items[items.length - 1].y - hi : 0;
    if (over > 0) for (let k = items.length - 1; k >= 0; k--) { const lim = k === items.length - 1 ? hi : items[k + 1].y - gap; if (items[k].y > lim) items[k].y = lim; }
    return items;
  }
  function renderMovers() {
    const s = snap(), p = prevSnap(), box = $("movers-chart");
    $("movers-sub").textContent = p ? `What changed between the ${fmtDate(p)} and ${fmtDate(s)} updates.` : "This is the first update of the year, so there's nothing to compare yet.";
    const UP = "var(--s-blue)", DOWN = "var(--s-red)";
    $("movers-legend").replaceChildren(...[[UP, "Climbed"], [DOWN, "Fell"], ["var(--axis)", "Everyone else"]].map(([c, t]) => {
      const k = h("span", "k"); const ln = h("span", "ln"); ln.style.background = c; k.append(ln, document.createTextNode(t)); return k;
    }), (() => { const k = h("span", "k"); const o = h("span", "ring"); k.append(o, document.createTextNode("New entry")); return k; })());

    const debs = ranked().filter((a) => move(a)?.kind === "new");
    $("debuts").replaceChildren(...(debs.length ? debs.map((a) => {
      const row = h("div", "debut");
      const nm = h("div", "nm"); nm.append(h("b", null, a.album), h("span", null, `${a.artist} · ${fmtStars(a.stars[s])} stars`));
      const c = cover(a, true); bindTip(c, () => albumTip(a));
      const hb = heat(a);
      row.append(h("div", "at", "#" + a.ranks[s]), c, nm, hb ? heatBadge(hb) : h("span"));
      return row;
    }) : [h("p", "empty", p ? "No new albums this time." : "Everything is new in the first update.")]));

    const W = Math.floor(box.clientWidth);
    if (!W) return;
    if (!p) { box.replaceChildren(h("p", "empty", "Nothing to compare yet.")); return; }
    const both = ranked().filter((a) => a.ranks[p] != null).map((a) => ({ a, d: relMove(a, S.si - 1, S.si), r0: a.ranks[p], r1: a.ranks[s] }));
    const ups = both.filter((x) => x.d > 0).sort((u, v) => v.d - u.d).slice(0, 6);
    const downs = both.filter((x) => x.d < 0).sort((u, v) => u.d - v.d).slice(0, 6);
    const hl = new Map([...ups.map((x) => [x.a.id, "up"]), ...downs.map((x) => [x.a.id, "down"])]);
    const narrow = W < 560;
    const m = { top: 30, bottom: 12, left: 44, right: narrow ? 128 : 250 };
    const maxR = Math.max(S.data.snapshotSizes[p], S.data.snapshotSizes[s]);
    const H = Math.max(380, Math.min(maxR * 9, 760)) + m.top + m.bottom;
    const x0 = m.left, x1 = W - m.right;
    const y = d3.scaleLinear([1, maxR], [m.top, H - m.bottom]);
    const svg = d3.create("svg").attr("width", "100%").attr("viewBox", `0 0 ${W} ${H}`).attr("role", "img").attr("aria-label", "Slope chart of rank changes since the previous update");
    box.replaceChildren(svg.node());
    [[x0, fmtDate(p)], [x1, fmtDate(s)]].forEach(([xx, t]) => {
      svg.append("line").attr("class", "c-axis").attr("x1", xx).attr("x2", xx).attr("y1", m.top - 8).attr("y2", H - m.bottom);
      svg.append("text").attr("class", "c-tick").attr("x", xx).attr("y", 12).attr("text-anchor", "middle").attr("font-weight", 600).text(t);
    });
    const col = (id) => (hl.get(id) === "up" ? UP : hl.get(id) === "down" ? DOWN : null);
    const ordered = [...both].sort((u, v) => (hl.has(u.a.id) - hl.has(v.a.id)));
    const g = svg.append("g");
    const lines = g.selectAll("g").data(ordered).join("g").attr("class", (d) => "slope" + (hl.has(d.a.id) ? " hl" : ""));
    lines.append("line").attr("x1", x0).attr("x2", x1).attr("y1", (d) => y(d.r0)).attr("y2", (d) => y(d.r1))
      .attr("stroke", (d) => col(d.a.id) || "var(--axis)").attr("stroke-width", (d) => (hl.has(d.a.id) ? 2.5 : 1.2)).attr("stroke-linecap", "round");
    lines.filter((d) => hl.has(d.a.id)).each(function (d) {
      const gg = d3.select(this);
      [[x0, d.r0], [x1, d.r1]].forEach(([xx, r]) => gg.append("circle").attr("cx", xx).attr("cy", y(r)).attr("r", 4).attr("fill", col(d.a.id)).attr("stroke", "var(--surface)").attr("stroke-width", 1.5));
    });
    // new entries: hollow rings on the right axis
    debs.forEach((a) => svg.append("circle").attr("cx", x1).attr("cy", y(a.ranks[s])).attr("r", 3.5).attr("fill", "var(--surface)").attr("stroke", "var(--ink)").attr("stroke-width", 1.5));

    // labels: start rank on the left, name and move on the right
    const hls = [...ups, ...downs];
    relax(hls.map((x) => ({ x, y0: y(x.r0) })), 13, m.top, H - m.bottom).forEach(({ x, y: yy }) => {
      svg.append("text").attr("class", "c-val").attr("x", x0 - 8).attr("y", yy).attr("dy", "0.32em").attr("text-anchor", "end").text("#" + x.r0);
    });
    relax(hls.map((x) => ({ x, y0: y(x.r1) })), 14, m.top, H - m.bottom).forEach(({ x, y0, y: yy }) => {
      svg.append("path").attr("d", `M${x1 + 5},${y0} L${x1 + 9},${y0} L${x1 + 12},${yy}`).attr("fill", "none").attr("stroke", "var(--axis)");
      const t = svg.append("text").attr("class", "c-lab").attr("x", x1 + 15).attr("y", yy).attr("dy", "0.32em");
      t.append("tspan").attr("font-weight", 600).attr("fill", col(x.a.id)).text(`${x.d > 0 ? "+" : "−"}${Math.abs(x.d)} `);
      t.append("tspan").attr("font-weight", 600).text(`#${x.r1} `);
      const nm = t.append("tspan").text(x.a.album);
      while (t.node().getComputedTextLength() > m.right - 18 && nm.text().length > 3) nm.text(nm.text().slice(0, -2).trimEnd() + "…");
    });

    // hover any line
    const hit = svg.append("g");
    both.forEach((d) => {
      hit.append("line").attr("x1", x0).attr("x2", x1).attr("y1", y(d.r0)).attr("y2", y(d.r1)).attr("stroke", "transparent").attr("stroke-width", 9)
        .on("pointermove pointerdown", (ev) => {
          lines.classed("dimmed", (q) => q.a.id !== d.a.id).classed("focus", (q) => q.a.id === d.a.id);
          showTip(ev, albumTip(d.a, [["tn", `#${d.r0} on ${fmtDate(p)} → #${d.r1} on ${fmtDate(s)}`],
            ["ts", d.d ? `${d.d > 0 ? "Passed" : "Passed by"} ${Math.abs(d.d)} album${Math.abs(d.d) === 1 ? "" : "s"} already on the list` : "Held its place among albums already on the list"]]));
        })
        .on("pointerleave", () => { lines.classed("dimmed", false).classed("focus", false); hideTip(); });
    });
  }

  // ---------- queue ----------
  function renderQueue() {
    const L = S.data.excitementLabels;
    const items = S.data.unrated.map((id) => S.byId.get(id));
    const lastExport = S.data.exports[S.data.exports.length - 1];
    $("queue-sub").textContent = `${items.length} releases from ${S.data.year} I've saved on RYM but haven't rated yet (as of ${fmtDate(lastExport)}), grouped by how excited I am about them.`;
    const order = (a, b) => (b.released || "").localeCompare(a.released || "") || a.artist.localeCompare(b.artist);
    const groups = [[3, L["3"]], [2, L["2"]], [1, L["1"]], [null, "Not tagged yet"]];
    $("queue-list").replaceChildren(...groups.map(([lvl, name]) => {
      const g = h("div", "q-group");
      const its = items.filter((a) => (a.excitement ?? null) === lvl).sort(order);
      const t = h("h3"); if (lvl) t.append(pips(lvl)); t.append(document.createTextNode(name), h("span", "count", String(its.length)));
      g.append(t);
      if (!its.length) { g.append(h("p", "q-empty", lvl ? `Nothing marked "${name}" yet. Set excitement (1 to 3) in data/tags.csv.` : "Everything in the queue has an excitement level.")); return g; }
      const grid = h("div", "q-grid");
      its.forEach((a) => {
        const card = h("div", "q-card");
        const body = h("div");
        body.append(h("b", null, a.album), h("div", "a", a.artist));
        if (a.released) body.append(h("div", "rel", `Released ${fmtRel(a)}`));
        card.append(cover(a), body);
        grid.append(card);
      });
      g.append(grid);
      return g;
    }));
  }
  function pips(n) { const p = h("span", "pips"); p.setAttribute("aria-hidden", "true"); for (let i = 1; i <= 3; i++) p.append(h("i", i <= n ? "on" : "")); return p; }

  // ---------- controls ----------
  function press(id, v) { $(id).querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === v))); }
  function wireSeg(id, key, after) {
    $(id).addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; S[key] = b.dataset.v; press(id, S[key]); after(); });
  }
  wireSeg("bump-scope", "bump", renderBump);
  // vibe pills cycle: any -> only albums with it -> only albums without it
  const NEXT = { any: "yes", yes: "no", no: "any" };
  const PILL = { artsy: ["f-artsy", "artsy", "Artsy"], aggr: ["f-aggr", "aggr", "Aggressive"] };
  function renderPills() {
    Object.values(PILL).forEach(([id, key, label]) => {
      const b = $(id), st = S[key];
      b.dataset.state = st;
      const word = st === "yes" ? "only" : st === "no" ? "none" : "any";
      b.replaceChildren(h("span", "dot " + (key === "aggr" ? "aggr" : "artsy")), h("span", "vp-l", label), h("span", "vp-s", word));
      b.setAttribute("aria-label", `${label}: ${st === "yes" ? `only ${label.toLowerCase()} albums` : st === "no" ? `hide ${label.toLowerCase()} albums` : "no filter"}. Click to change.`);
    });
    const parts = [];
    if (S.artsy !== "any") parts.push(S.artsy === "yes" ? "artsy" : "not artsy");
    if (S.aggr !== "any") parts.push(S.aggr === "yes" ? "aggressive" : "not aggressive");
    $("vf-hint").textContent = parts.length ? `Showing ${parts.join(", ")} albums.` : "Tap a vibe to require it, tap again to exclude it.";
  }
  Object.values(PILL).forEach(([id, key]) => $(id).addEventListener("click", () => { S[key] = NEXT[S[key]]; renderTable(); }));
  function renderBadgeKey() {
    const items = [
      [moveBadge({ kind: "up", d: 3 }), "places climbed since the last update"],
      [moveBadge({ kind: "down", d: 2 }), "places dropped"],
      [moveBadge({ kind: "new" }), "on the list for the first time"],
      ...Object.entries(HEAT).map(([name, [, , desc]]) => [heatBadge(name), desc.charAt(0).toLowerCase() + desc.slice(1)]),
    ];
    ["badge-key", "badge-key-top"].forEach((id) => $(id).replaceChildren(...items.map(([b, t]) => { const r = h("div", "bk"); r.append(b.cloneNode(true), h("span", null, t)); return r; })));
  }
  renderBadgeKey();
  $("q").addEventListener("input", (e) => { S.q = e.target.value; renderTable(); });
  $("snap").addEventListener("change", (e) => setSnap(+e.target.value));
  $("snap-prev").addEventListener("click", () => setSnap(S.si - 1));
  $("snap-next").addEventListener("click", () => setSnap(S.si + 1));
  $("year").addEventListener("change", (e) => load(+e.target.value));

  function setSnap(i) {
    if (i < 0 || i >= S.snaps.length) return;
    S.si = i;
    $("snap").value = String(i);
    $("snap-prev").disabled = i === 0;
    $("snap-next").disabled = i === S.snaps.length - 1;
    const u = new URL(location); u.searchParams.set("snap", S.snaps[i]); u.searchParams.set("year", S.data.year); history.replaceState(null, "", u);
    renderAll();
  }

  function renderAll() {
    renderHero(); renderTop10(); renderTopster(); renderBump(); renderTable(); renderMovers(); renderQueue();
    $("foot").textContent = `Last updated ${fmtLong(S.snaps[S.snaps.length - 1])} · site built ${S.data.built.slice(0, 10)}.`;
  }

  let lastW = innerWidth;
  addEventListener("resize", () => { if (Math.abs(innerWidth - lastW) < 4) return; lastW = innerWidth; if (S.data) { renderBump(); renderMovers(); } });

  async function load(year) {
    const res = await fetch(`data/${year}.json`, { cache: "no-cache" });
    S.data = await res.json();
    S.byId = new Map(S.data.albums.map((a) => [a.id, a]));
    relCache.clear();
    S.snaps = S.data.snapshots;
    $("snap").replaceChildren(...S.snaps.map((s, i) => new Option(`${fmtLong(s)}${i === S.snaps.length - 1 ? " (latest)" : ""}`, String(i))));
    const want = S.snaps.indexOf(qs.get("snap"));
    setSnap(want >= 0 ? want : S.snaps.length - 1);
  }

  async function init() {
    press("bump-scope", S.bump);
    let years = [];
    try { years = (await (await fetch("data/index.json", { cache: "no-cache" })).json()).years; } catch (e) { /* fall through */ }
    if (!years.length) { $("lede").textContent = "No data yet. Run python tools/build.py."; return; }
    const ysel = $("year");
    ysel.replaceChildren(...years.map((y) => new Option(String(y), String(y))));
    ysel.hidden = years.length < 2;
    const y = +(qs.get("year") || years[years.length - 1]);
    ysel.value = String(y);
    await load(years.includes(y) ? y : years[years.length - 1]);
  }
  init();
})();
