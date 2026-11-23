/* Browse page: lists every palette in the birdcolors package. */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const gallery = $("gallery");
  const status = $("gallery-status");
  const searchInput = $("search");
  const nColorsSel = $("n-colors");
  const sortSel = $("sort");
  const recOnly = $("rec-only");
  const toast = $("toast");

  const REC_LABELS = { discrete: "Discrete", sequential: "Sequential", diverging: "Diverging" };

  let all = []; // [{ name, display, colors, rec, order }]

  // ---------------------------------------------------------------------------

  function relativeLuminance(hex) {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  function showToast(text) {
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(showToast.t);
    showToast.t = setTimeout(() => { toast.hidden = true; }, 1600);
  }

  /** Older/stricter browsers: copy via a hidden, selected textarea. */
  function legacyCopy(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    ta.remove();
    return ok;
  }

  async function copy(text, label) {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      ok = legacyCopy(text);
    }
    showToast(ok ? `Copied ${label || text}` : `Couldn't copy automatically: ${text}`);
  }

  // ---------------------------------------------------------------------------

  function card(p) {
    const el = document.createElement("article");
    el.className = "palette-card";

    const head = document.createElement("div");
    head.className = "palette-head";
    const h = document.createElement("h2");
    h.textContent = p.display;
    head.append(h);
    if (p.rec) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "Recommended · " + REC_LABELS[p.rec];
      badge.title = "Recommended in bird_menu(\"rec\") as a " + p.rec + " palette";
      head.append(badge);
    }
    const n = document.createElement("span");
    n.className = "n-colors";
    n.textContent = `${p.colors.length} colours`;
    head.append(n);

    const strip = document.createElement("div");
    strip.className = "palette-strip";
    p.colors.forEach((hex, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.style.background = hex;
      b.title = `${hex} — click to copy`;
      b.setAttribute("aria-label", `Colour ${i + 1}: ${hex}. Copy hex code`);
      b.addEventListener("click", () => copy(hex));
      strip.append(b);
    });

    const chips = document.createElement("div");
    chips.className = "hex-chips";
    p.colors.forEach((hex) => {
      const c = document.createElement("button");
      c.type = "button";
      c.className = "hex-chip";
      const dot = document.createElement("span");
      dot.style.background = hex;
      if (relativeLuminance(hex) > 0.85) dot.classList.add("light");
      c.append(dot, hex);
      c.title = "Copy " + hex;
      c.addEventListener("click", () => copy(hex));
      chips.append(c);
    });

    const code = document.createElement("div");
    code.className = "palette-code";
    const rCall = `bird_colors("${p.name}")`;
    const pre = document.createElement("code");
    pre.textContent = rCall;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "secondary small";
    btn.textContent = "Copy R";
    btn.addEventListener("click", () => copy(rCall, "R code"));
    code.append(pre, btn);

    el.append(head, strip, chips, code);
    return el;
  }

  // Lower-case, drop apostrophes, treat hyphens/underscores as spaces.
  const norm = (s) => s.toLowerCase().replace(/['\u2019]/g, "").replace(/[-_\s]+/g, " ").trim();

  function render() {
    const q = norm(searchInput.value);
    const qHex = searchInput.value.trim().toUpperCase().replace(/^#?/, "#");
    const n = parseInt(nColorsSel.value, 10);

    let list = all.filter((p) =>
      (!q || p.search.includes(q) || p.colors.some((c) => c.startsWith(qHex))) &&
      (!n || p.colors.length === n) &&
      (!recOnly.checked || p.rec));

    list = list.slice().sort(sortSel.value === "name"
      ? (a, b) => a.display.localeCompare(b.display)
      : (a, b) => a.order - b.order);

    gallery.replaceChildren(...list.map(card));
    status.textContent = list.length === all.length
      ? `${all.length} palettes`
      : `Showing ${list.length} of ${all.length} palettes`;
  }

  [searchInput, nColorsSel, sortSel, recOnly].forEach((el) =>
    el.addEventListener(el === searchInput ? "input" : "change", render));

  window.BirdPalettes.load()
    .then(({ palettes, recommended }) => {
      all = palettes.map((p, i) => {
        const display = window.BirdPalettes.displayName(p.name);
        return {
          ...p,
          display,
          rec: recommended[p.name] || null,
          order: i,
          search: norm(display) + " | " + norm(p.name),
        };
      });
      if (!all.length) throw new Error("no palettes found");
      render();
    })
    .catch((err) => {
      status.textContent = "";
      const msg = document.createElement("span");
      msg.textContent = `Sorry, the palettes couldn't be loaded (${err.message}). You can see them in `;
      const a = document.createElement("a");
      a.href = "https://github.com/bentonelli/birdcolors/blob/main/R/base_colors.R";
      a.textContent = "the package source on GitHub";
      status.append(msg, a, ".");
      status.classList.add("err");
    });
})();
