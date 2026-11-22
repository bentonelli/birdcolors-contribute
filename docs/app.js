/* birdcolors palette contribution page
 * Plain JavaScript, no build step. The photo never leaves the browser;
 * only the palette and form fields are sent to SUBMIT_URL.
 */
(() => {
  "use strict";

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  // Paste your Google Apps Script web-app URL here (ends in /exec).
  // See README.md (setup steps). While empty, submissions are not sent.
  const SUBMIT_URL = "https://script.google.com/macros/s/AKfycbxDKaNe_T_NSt-pzUbsJUfjIWwJS1p0OsH7yAYvCu4s9-A_ywrCScd2Wti2G_0AGRE/exec";

  // Existing palettes, used to warn about duplicates.
  const PALETTE_SOURCE_URL =
    "https://raw.githubusercontent.com/bentonelli/birdcolors/main/R/base_colors.R";

  const MIN_COLORS = 2;
  const MAX_COLORS = 9;
  const MAX_IMAGE_DIM = 2000; // longest side of the working copy, in pixels
  const LOUPE_PX = 132;

  // ---------------------------------------------------------------------------
  // Elements
  // ---------------------------------------------------------------------------

  const $ = (id) => document.getElementById(id);
  const dropzone = $("dropzone");
  const fileInput = $("file-input");
  const imageMessage = $("image-message");
  const picker = $("picker");
  const canvas = $("image-canvas");
  const ctx = canvas.getContext("2d");
  const loupe = $("loupe");
  const loupeCanvas = $("loupe-canvas");
  const loupeCtx = loupeCanvas.getContext("2d");
  const loupeHex = $("loupe-hex");
  const sampleSizeSel = $("sample-size");
  const swatchList = $("swatches");
  const emptyMsg = $("empty-palette");
  const countEl = $("count");
  const previewEl = $("preview");
  const rCodeEl = $("r-code");
  const form = $("submit-form");
  const speciesInput = $("species");
  const speciesWarning = $("species-warning");
  const formErrors = $("form-errors");
  const submitBtn = $("submit-btn");
  const submitMessage = $("submit-message");

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  /** @type {{hex: string, x: number|null, y: number|null}[]} */
  let palette = [];
  let srcCanvas = null; // clean copy of the photo, used for sampling + loupe
  let srcPixels = null; // ImageData of srcCanvas
  let pointerActive = false;
  let existingPalettes = new Set();

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const toHex = (n) => n.toString(16).padStart(2, "0").toUpperCase();
  const rgbToHex = (r, g, b) => "#" + toHex(r) + toHex(g) + toHex(b);

  /** Accepts "abc", "#abc", "aabbcc", "#AABBCC". Returns "#AABBCC" or null. */
  function normalizeHex(value) {
    let v = String(value).trim().replace(/^#/, "");
    if (/^[0-9a-f]{3}$/i.test(v)) v = v.split("").map((c) => c + c).join("");
    return /^[0-9a-f]{6}$/i.test(v) ? "#" + v.toUpperCase() : null;
  }

  /** Mirrors bird_colors(): gsub("[- ']", "_", name), plus a little extra cleanup. */
  function paletteName(species) {
    return species
      .normalize("NFD").replace(/[̀-ͯ]/g, "") // strip accents
      .trim()
      .replace(/[-\s'’]/g, "_")
      .replace(/[^A-Za-z0-9_]/g, "");
  }

  function relativeLuminance(hex) {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  function showMessage(el, text, kind) {
    el.textContent = text;
    el.className = "message " + kind;
    el.hidden = !text;
  }

  // ---------------------------------------------------------------------------
  // Image loading
  // ---------------------------------------------------------------------------

  const isHeic = (file) =>
    /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name || "");

  function loadFile(file) {
    if (!file) return;
    if (file.type && !file.type.startsWith("image/") && !isHeic(file)) {
      showMessage(imageMessage, "That file doesn't look like an image. Please use a JPEG, PNG or WebP photo.", "err");
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); useImage(img); };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      showMessage(imageMessage, isHeic(file)
        ? "This browser can't open HEIC photos (the iPhone default). Please convert it to JPEG first, or export it as “Most Compatible”."
        : "Sorry, that image couldn't be opened. Please try a JPEG or PNG.", "err");
    };
    img.src = url;
  }

  /** A link (not a file) was dropped, e.g. an image dragged from another tab. */
  function loadUrl(url) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => useImage(img);
    img.onerror = () => showMessage(imageMessage,
      "That image is on another website that doesn't allow it to be read here. Please save it to your computer first, then drop the saved file.", "err");
    img.src = url;
  }

  function useImage(img) {
    const w0 = img.naturalWidth, h0 = img.naturalHeight;
    if (!w0 || !h0) {
      showMessage(imageMessage, "That image appears to be empty.", "err");
      return;
    }
    const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(w0, h0));
    const w = Math.round(w0 * scale), h = Math.round(h0 * scale);

    const sc = document.createElement("canvas");
    sc.width = w; sc.height = h;
    const sctx = sc.getContext("2d", { willReadFrequently: true });
    sctx.drawImage(img, 0, 0, w, h);
    try {
      srcPixels = sctx.getImageData(0, 0, w, h);
    } catch (e) {
      // Cross-origin image without CORS headers ("tainted" canvas).
      showMessage(imageMessage,
        "That image can't be read because it comes from another website. Please save it to your computer first, then drop the saved file.", "err");
      return;
    }
    srcCanvas = sc;
    canvas.width = w; canvas.height = h;

    // Picks from a previous photo no longer have a location on this one.
    palette.forEach((p) => { p.x = p.y = null; });

    showMessage(imageMessage, "", "ok");
    dropzone.hidden = true;
    picker.hidden = false;
    redrawCanvas();
    renderPalette();
    picker.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // File picker / keyboard
  fileInput.addEventListener("change", () => { loadFile(fileInput.files[0]); fileInput.value = ""; });
  dropzone.addEventListener("click", (e) => {
    if (e.target.closest("label, input")) return; // the label opens the picker itself
    fileInput.click();
  });
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
  });
  $("change-image").addEventListener("click", () => fileInput.click());

  // Drag and drop anywhere on the page (files or links), but ignore swatch reordering.
  const isExternalDrag = (e) => {
    const t = Array.from(e.dataTransfer?.types || []);
    return !t.includes("application/x-swatch") &&
      (t.includes("Files") || t.includes("text/uri-list"));
  };
  let dragDepth = 0;
  window.addEventListener("dragenter", (e) => {
    if (!isExternalDrag(e)) return;
    dragDepth++; dropzone.classList.add("dragover");
  });
  window.addEventListener("dragleave", (e) => {
    if (!isExternalDrag(e)) return;
    if (--dragDepth <= 0) { dragDepth = 0; dropzone.classList.remove("dragover"); }
  });
  window.addEventListener("dragover", (e) => {
    if (isExternalDrag(e)) e.preventDefault();
  });
  window.addEventListener("drop", (e) => {
    if (!isExternalDrag(e)) return;
    e.preventDefault();
    dragDepth = 0; dropzone.classList.remove("dragover");
    const file = Array.from(e.dataTransfer.files || []).find((f) => f.type.startsWith("image/") || isHeic(f))
      || e.dataTransfer.files[0];
    if (file) return loadFile(file);
    const url = (e.dataTransfer.getData("text/uri-list") || "").split(/\r?\n/).find((l) => l && !l.startsWith("#"));
    if (url) loadUrl(url.trim());
  });

  // Paste an image from the clipboard
  window.addEventListener("paste", (e) => {
    if (e.target.closest && e.target.closest("input, textarea")) return;
    const item = Array.from(e.clipboardData?.items || []).find((i) => i.type.startsWith("image/"));
    if (item) { e.preventDefault(); loadFile(item.getAsFile()); }
  });

  // ---------------------------------------------------------------------------
  // Colour picking
  // ---------------------------------------------------------------------------

  function canvasPoint(e) {
    const r = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) * (canvas.width / r.width));
    const y = Math.floor((e.clientY - r.top) * (canvas.height / r.height));
    return {
      x: Math.max(0, Math.min(canvas.width - 1, x)),
      y: Math.max(0, Math.min(canvas.height - 1, y)),
    };
  }

  /** Mean colour of an n x n square centred on (cx, cy), clipped to the image. */
  function sampleAt(cx, cy) {
    const n = parseInt(sampleSizeSel.value, 10) || 1;
    const half = Math.floor(n / 2);
    const { width, height, data } = srcPixels;
    let r = 0, g = 0, b = 0, count = 0;
    for (let y = cy - half; y <= cy + half; y++) {
      if (y < 0 || y >= height) continue;
      for (let x = cx - half; x <= cx + half; x++) {
        if (x < 0 || x >= width) continue;
        const i = (y * width + x) * 4;
        if (data[i + 3] === 0) continue; // fully transparent
        r += data[i]; g += data[i + 1]; b += data[i + 2]; count++;
      }
    }
    if (!count) return null;
    return rgbToHex(Math.round(r / count), Math.round(g / count), Math.round(b / count));
  }

  function updateLoupe(e) {
    if (!srcCanvas) return;
    const { x, y } = canvasPoint(e);
    const n = parseInt(sampleSizeSel.value, 10) || 1;
    let view = Math.max(11, n + 6);
    if (view % 2 === 0) view++;
    const zoom = LOUPE_PX / view;
    const half = Math.floor(view / 2);

    loupeCtx.imageSmoothingEnabled = false;
    loupeCtx.fillStyle = "#888";
    loupeCtx.fillRect(0, 0, LOUPE_PX, LOUPE_PX);
    loupeCtx.drawImage(srcCanvas, x - half, y - half, view, view, 0, 0, LOUPE_PX, LOUPE_PX);

    // Outline of the area being averaged
    const box = n * zoom;
    const o = (LOUPE_PX - box) / 2;
    loupeCtx.lineWidth = 2;
    loupeCtx.strokeStyle = "rgba(0,0,0,.8)";
    loupeCtx.strokeRect(o - 1, o - 1, box + 2, box + 2);
    loupeCtx.strokeStyle = "rgba(255,255,255,.95)";
    loupeCtx.strokeRect(o + 1, o + 1, box - 2, box - 2);

    const hex = sampleAt(x, y);
    loupeHex.textContent = hex || "";

    // Position: up-right of a mouse cursor, directly above a finger.
    const wrap = canvas.parentElement.getBoundingClientRect();
    const px = e.clientX - wrap.left, py = e.clientY - wrap.top;
    const touch = e.pointerType === "touch" || e.pointerType === "pen";
    let left = touch ? px - 69 : px + 24;
    let top = touch ? py - 190 : py - 160;
    if (!touch && left + 140 > wrap.width) left = px - 164;
    if (top < -40) top = py + 30;
    loupe.style.left = left + "px";
    loupe.style.top = top + "px";
    loupe.hidden = false;
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (!srcCanvas || e.button > 0) return;
    pointerActive = true;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* not critical */ }
    updateLoupe(e);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (pointerActive || e.pointerType === "mouse") updateLoupe(e);
  });
  canvas.addEventListener("pointerup", (e) => {
    if (!pointerActive) return;
    pointerActive = false;
    const { x, y } = canvasPoint(e);
    addColor(sampleAt(x, y), x, y);
    if (e.pointerType !== "mouse") loupe.hidden = true;
    else updateLoupe(e);
  });
  canvas.addEventListener("pointercancel", () => { pointerActive = false; loupe.hidden = true; });
  canvas.addEventListener("pointerleave", (e) => { if (!pointerActive && e.pointerType === "mouse") loupe.hidden = true; });
  sampleSizeSel.addEventListener("change", () => { loupe.hidden = true; });

  function redrawCanvas() {
    if (!srcCanvas) return;
    ctx.drawImage(srcCanvas, 0, 0);
    // Marker size in image pixels so it looks the same regardless of display scaling.
    const rect = canvas.getBoundingClientRect();
    const k = rect.width ? canvas.width / rect.width : 1;
    const radius = 11 * k;
    ctx.font = `bold ${Math.round(12 * k)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    palette.forEach((p, i) => {
      if (p.x == null) return;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = p.hex;
      ctx.fill();
      ctx.lineWidth = 2.5 * k;
      ctx.strokeStyle = "#fff";
      ctx.stroke();
      ctx.lineWidth = 1 * k;
      ctx.strokeStyle = "rgba(0,0,0,.6)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius + 2 * k, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = relativeLuminance(p.hex) > 0.4 ? "#000" : "#fff";
      ctx.fillText(String(i + 1), p.x, p.y + 0.5 * k);
    });
  }
  window.addEventListener("resize", () => redrawCanvas());

  // ---------------------------------------------------------------------------
  // Palette editing
  // ---------------------------------------------------------------------------

  function addColor(hex, x = null, y = null) {
    if (!hex) return false;
    if (palette.length >= MAX_COLORS) {
      flashCount();
      return false;
    }
    palette.push({ hex, x, y });
    renderPalette();
    return true;
  }

  function flashCount() {
    countEl.textContent = `Palettes can have at most ${MAX_COLORS} colours — remove one to add another.`;
    countEl.classList.add("full");
    clearTimeout(flashCount.t);
    flashCount.t = setTimeout(updateSummary, 2500);
  }

  function move(from, to) {
    if (to < 0 || to >= palette.length || from === to) return;
    const [item] = palette.splice(from, 1);
    palette.splice(to, 0, item);
    renderPalette();
  }

  function renderPalette() {
    swatchList.replaceChildren();
    palette.forEach((p, i) => {
      const li = document.createElement("li");
      li.className = "swatch";
      li.draggable = true;
      li.dataset.index = String(i);

      const color = document.createElement("div");
      color.className = "swatch-color";
      color.style.background = p.hex;
      const num = document.createElement("span");
      num.className = "swatch-num";
      num.textContent = String(i + 1);
      color.append(num);

      const input = document.createElement("input");
      input.type = "text";
      input.value = p.hex;
      input.maxLength = 7;
      input.spellcheck = false;
      input.setAttribute("aria-label", `Colour ${i + 1} hex code`);
      input.addEventListener("input", () => {
        const hex = normalizeHex(input.value);
        input.classList.toggle("invalid", !hex);
        if (hex) {
          p.hex = hex;
          color.style.background = hex;
          updateSummary();
          redrawCanvas();
        }
      });
      input.addEventListener("blur", () => {
        input.value = p.hex;
        input.classList.remove("invalid");
      });
      // Let people select text in the input without starting a drag.
      input.addEventListener("pointerdown", () => { li.draggable = false; });
      input.addEventListener("pointerup", () => { li.draggable = true; });

      const buttons = document.createElement("div");
      buttons.className = "swatch-buttons";
      const mk = (label, title, fn, disabled) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        b.title = title;
        b.setAttribute("aria-label", `${title} (colour ${i + 1})`);
        b.disabled = !!disabled;
        b.addEventListener("click", fn);
        return b;
      };
      buttons.append(
        mk("←", "Move left", () => move(i, i - 1), i === 0),
        mk("→", "Move right", () => move(i, i + 1), i === palette.length - 1),
        mk("✕", "Remove", () => { palette.splice(i, 1); renderPalette(); }),
      );

      li.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("application/x-swatch", String(i));
        e.dataTransfer.effectAllowed = "move";
        li.classList.add("dragging");
      });
      li.addEventListener("dragend", () => {
        li.classList.remove("dragging");
        swatchList.querySelectorAll(".drop-target").forEach((el) => el.classList.remove("drop-target"));
      });
      li.addEventListener("dragover", (e) => {
        if (!e.dataTransfer.types.includes("application/x-swatch")) return;
        e.preventDefault();
        li.classList.add("drop-target");
      });
      li.addEventListener("dragleave", () => li.classList.remove("drop-target"));
      li.addEventListener("drop", (e) => {
        const from = e.dataTransfer.getData("application/x-swatch");
        if (from === "") return;
        e.preventDefault();
        move(parseInt(from, 10), i);
      });

      li.append(color, input, buttons);
      swatchList.append(li);
    });

    emptyMsg.hidden = palette.length > 0;
    updateSummary();
    redrawCanvas();
  }

  function rCode() {
    const name = paletteName(speciesInput.value) || "Bird_Name";
    const cols = palette.map((p) => `"${p.hex}"`).join(",");
    return `${name} = c(${cols})`;
  }

  function updateSummary() {
    countEl.textContent = `${palette.length} / ${MAX_COLORS} colours`;
    countEl.classList.toggle("full", palette.length >= MAX_COLORS);
    previewEl.replaceChildren(...palette.map((p) => {
      const d = document.createElement("div");
      d.style.background = p.hex;
      d.title = p.hex;
      return d;
    }));
    rCodeEl.textContent = rCode();
  }

  $("add-manual").addEventListener("click", () => {
    if (addColor("#FFFFFF")) {
      const inputs = swatchList.querySelectorAll("input");
      const last = inputs[inputs.length - 1];
      last.focus();
      last.select();
    }
  });
  $("clear-palette").addEventListener("click", () => {
    if (palette.length && !confirm("Remove all colours from the palette?")) return;
    palette = [];
    renderPalette();
  });
  $("copy-r").addEventListener("click", async (e) => {
    try {
      await navigator.clipboard.writeText(rCode());
      e.target.textContent = "Copied!";
    } catch {
      e.target.textContent = "Copy failed";
    }
    setTimeout(() => { e.target.textContent = "Copy"; }, 1500);
  });

  // ---------------------------------------------------------------------------
  // Existing palettes (duplicate warning)
  // ---------------------------------------------------------------------------

  fetch(PALETTE_SOURCE_URL)
    .then((r) => (r.ok ? r.text() : ""))
    .then((src) => {
      // Palette entries look like:  Scarlet_Tanager = c("#34323F","#AA2720"),
      const start = src.indexOf("bird_palettes <- list(");
      const end = src.indexOf("rec_bird_palettes");
      const block = start >= 0 ? src.slice(start, end > start ? end : undefined) : "";
      for (const m of block.matchAll(/^\s*([A-Z][A-Za-z0-9_]*)\s*=\s*c\(/gm)) {
        existingPalettes.add(m[1].toLowerCase());
      }
      checkSpecies();
    })
    .catch(() => { /* offline or blocked: skip the duplicate check */ });

  function checkSpecies() {
    const name = paletteName(speciesInput.value);
    const dup = name && existingPalettes.has(name.toLowerCase());
    speciesWarning.hidden = !dup;
    speciesWarning.textContent = dup
      ? "birdcolors already has a palette for this bird. You can still submit one (e.g. a different plumage) — say why in the notes."
      : "";
  }
  speciesInput.addEventListener("input", () => { checkSpecies(); updateSummary(); });

  // ---------------------------------------------------------------------------
  // Submission
  // ---------------------------------------------------------------------------

  function validate() {
    const errors = [];
    if (!$("first-name").value.trim()) errors.push("Please enter your first name.");
    if (!$("last-name").value.trim()) errors.push("Please enter your last name.");
    if (!speciesInput.value.trim()) errors.push("Please enter the bird's common name.");
    else if (!paletteName(speciesInput.value)) errors.push("The bird's name should contain letters.");
    if (palette.length < MIN_COLORS) errors.push(`Pick at least ${MIN_COLORS} colours.`);
    if (palette.length > MAX_COLORS) errors.push(`Use at most ${MAX_COLORS} colours.`);
    const hexes = palette.map((p) => p.hex);
    if (new Set(hexes).size !== hexes.length) errors.push("Two of your colours are identical — remove the duplicate.");
    return errors;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (submitBtn.disabled) return;

    const errors = validate();
    formErrors.replaceChildren(...errors.map((t) => {
      const li = document.createElement("li");
      li.textContent = t;
      return li;
    }));
    formErrors.hidden = errors.length === 0;
    showMessage(submitMessage, "", "ok");
    if (errors.length) return;

    const payload = {
      first_name: $("first-name").value.trim(),
      last_name: $("last-name").value.trim(),
      species: speciesInput.value.trim(),
      palette_name: paletteName(speciesInput.value),
      palette_type: $("palette-type").value,
      colors: palette.map((p) => p.hex),
      r_code: rCode(),
      photo_credit: $("photo-credit").value.trim(),
      notes: $("notes").value.trim(),
      website: $("website").value, // honeypot
      page: location.origin + location.pathname,
    };

    if (!SUBMIT_URL) {
      console.info("birdcolors submission payload (SUBMIT_URL not set):", payload);
      showMessage(submitMessage,
        "Submissions aren't switched on yet (no SUBMIT_URL configured). Your palette was not sent — you can copy the R code above instead.", "warn");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Sending…";
    try {
      // text/plain keeps this a "simple" request, so the browser skips the
      // CORS preflight that Google Apps Script cannot answer.
      const res = await fetch(SUBMIT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.ok) throw new Error(out.error || `Server responded ${res.status}`);

      showMessage(submitMessage,
        `Thank you, ${payload.first_name}! Your ${payload.species} palette was submitted for review.`, "ok");
      palette = [];
      renderPalette();
      speciesInput.value = "";
      $("palette-type").value = "";
      $("photo-credit").value = "";
      $("notes").value = "";
      checkSpecies();
      updateSummary();
    } catch (err) {
      showMessage(submitMessage,
        `Sorry, the palette couldn't be sent (${String(err.message).replace(/\.$/, "")}).Please try again, or copy the R code above and open a GitHub issue.`, "err");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit palette";
    }
  });

  renderPalette();
})();
