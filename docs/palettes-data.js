/* Shared helpers: load the current birdcolors palettes straight from the
 * package source on GitHub, so both pages update as soon as palettes are
 * added to R/base_colors.R. Exposes window.BirdPalettes.
 */
window.BirdPalettes = (() => {
  "use strict";

  const SOURCE_URL =
    "https://raw.githubusercontent.com/bentonelli/birdcolors/main/R/base_colors.R";

  // Names the automatic prettifier gets wrong.
  const NAME_OVERRIDES = {
    Andean_Cock_of_the_Rock: "Andean Cock-of-the-rock",
  };

  /** Slice out the R code for `name <- list( ... )`, matching parentheses. */
  function listBlock(src, name) {
    const m = new RegExp("^" + name + "\\s*<-\\s*list\\(", "m").exec(src);
    if (!m) return "";
    const start = m.index;
    let depth = 0;
    for (let i = src.indexOf("(", start); i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")" && --depth === 0) return src.slice(start, i + 1);
    }
    return src.slice(start);
  }

  /** Remove R comments so commented-out palettes are ignored. */
  const stripComments = (code) => code.replace(/#(?![0-9A-Fa-f]{6}\b).*$/gm, "");

  function parse(src) {
    const palettes = [];
    const block = stripComments(listBlock(src, "bird_palettes"));
    for (const m of block.matchAll(/([A-Za-z][A-Za-z0-9_]*)\s*=\s*c\(([^)]*)\)/g)) {
      const colors = (m[2].match(/#[0-9A-Fa-f]{6}\b/g) || []).map((c) => c.toUpperCase());
      if (colors.length) palettes.push({ name: m[1], colors });
    }

    const recommended = {}; // palette name -> "discrete" | "sequential" | "diverging"
    const rec = stripComments(listBlock(src, "rec_bird_palettes"));
    for (const m of rec.matchAll(/(\w+)\s*=\s*c\(([^)]*)\)/g)) {
      for (const n of m[2].match(/"[^"]+"/g) || []) recommended[n.slice(1, -1)] = m[1];
    }
    return { palettes, recommended };
  }

  let cached = null;
  function load() {
    if (!cached) {
      cached = fetch(SOURCE_URL, { cache: "no-cache" })
        .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`GitHub responded ${r.status}`))))
        .then(parse);
      cached.catch(() => { cached = null; }); // allow a retry after a failure
    }
    return cached;
  }

  /** "Cassin_s_Finch" -> "Cassin's Finch", "Thick_billed_Euphonia" -> "Thick-billed Euphonia" */
  function displayName(name) {
    if (NAME_OVERRIDES[name]) return NAME_OVERRIDES[name];
    return name
      .replace(/([A-Za-z])_s_(?=[A-Z])/g, "$1's ")
      .replace(/_(?=[a-z])/g, "-")
      .replace(/_/g, " ");
  }

  return { SOURCE_URL, load, parse, displayName };
})();
