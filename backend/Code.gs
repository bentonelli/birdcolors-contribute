/**
 * birdcolors palette submissions -> Google Sheet
 *
 * Paste this into the Apps Script editor of a Google Sheet
 * (Extensions > Apps Script) and deploy it as a web app.
 * Full instructions: README.md in this repository
 */

// Tab that receives submissions (created automatically if missing).
const SHEET_NAME = "Submissions";

// Optional: an address to email on every new submission. Leave "" to disable.
const NOTIFY_EMAIL = "";

// Crude global spam brake: refuse more than this many submissions per hour.
const MAX_PER_HOUR = 60;

const HEADERS = [
  "timestamp", "status", "first_name", "last_name", "species", "palette_name",
  "palette_type", "n_colors", "colors", "r_code", "photo_credit", "notes", "page",
];

function doPost(e) {
  try {
    const data = JSON.parse((e && e.postData && e.postData.contents) || "{}");

    // Honeypot field filled in: almost certainly a bot. Pretend it worked.
    if (data.website) return json_({ ok: true });

    const clean = validate_(data);

    const cache = CacheService.getScriptCache();
    const hourKey = "count_" + Utilities.formatDate(new Date(), "UTC", "yyyyMMddHH");
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const count = Number(cache.get(hourKey) || 0);
      if (count >= MAX_PER_HOUR) {
        return json_({ ok: false, error: "Too many submissions right now, please try again later." });
      }
      cache.put(hourKey, String(count + 1), 3600);

      sheet_().appendRow([
        new Date(),
        "new",
        clean.first_name,
        clean.last_name,
        clean.species,
        clean.palette_name,
        clean.palette_type,
        clean.colors.length,
        clean.colors.join(", "),
        clean.r_code,
        clean.photo_credit,
        clean.notes,
        clean.page,
      ].map(safeCell_));
    } finally {
      lock.releaseLock();
    }

    if (NOTIFY_EMAIL) {
      MailApp.sendEmail({
        to: NOTIFY_EMAIL,
        subject: "New birdcolors palette: " + clean.species,
        body: [
          "From: " + clean.first_name + " " + clean.last_name,
          "Bird: " + clean.species + (clean.palette_type ? " (" + clean.palette_type + ")" : ""),
          "",
          clean.r_code,
          "",
          "Photo: " + (clean.photo_credit || "-"),
          "Notes: " + (clean.notes || "-"),
        ].join("\n"),
      });
    }

    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

// Visiting the URL in a browser shows this; handy for checking the deployment.
function doGet() {
  return json_({ ok: true, service: "birdcolors palette submissions" });
}

function validate_(d) {
  const str = (v, max) => String(v == null ? "" : v).trim().slice(0, max);
  const out = {
    first_name: str(d.first_name, 60),
    last_name: str(d.last_name, 60),
    species: str(d.species, 80),
    palette_type: str(d.palette_type, 20),
    photo_credit: str(d.photo_credit, 200),
    notes: str(d.notes, 1000),
    page: str(d.page, 200),
  };
  if (!out.first_name || !out.last_name) throw new Error("First and last name are required.");
  if (!out.species) throw new Error("Bird name is required.");
  if (["", "discrete", "sequential", "diverging"].indexOf(out.palette_type) < 0) {
    throw new Error("Unknown palette type.");
  }

  // Rebuild the palette name and R code server-side rather than trusting the client.
  out.palette_name = out.species
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[-\s'’]/g, "_")
    .replace(/[^A-Za-z0-9_]/g, "");
  if (!out.palette_name) throw new Error("Bird name should contain letters.");

  if (!Array.isArray(d.colors)) throw new Error("Colours are missing.");
  out.colors = d.colors.map((c) => String(c).trim().toUpperCase());
  if (out.colors.length < 2 || out.colors.length > 9) throw new Error("Palettes need 2 to 9 colours.");
  if (!out.colors.every((c) => /^#[0-9A-F]{6}$/.test(c))) throw new Error("Invalid colour code.");

  out.r_code = out.palette_name + " = c(" + out.colors.map((c) => '"' + c + '"').join(",") + ")";
  return out;
}

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) {
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
  }
  return sh;
}

// Stop user text being interpreted as a spreadsheet formula.
function safeCell_(v) {
  return typeof v === "string" && /^[=+\-@]/.test(v) ? "'" + v : v;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Run once from the editor to check everything works (adds a test row). */
function testSubmission() {
  const res = doPost({
    postData: {
      contents: JSON.stringify({
        first_name: "Test", last_name: "User", species: "Painted Bunting",
        palette_type: "discrete", colors: ["#166EC6", "#E73619", "#8FA200", "#EA9606"],
        photo_credit: "test", notes: "delete me", page: "editor",
      }),
    },
  });
  Logger.log(res.getContent());
}
