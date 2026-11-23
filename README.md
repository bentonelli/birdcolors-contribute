# birdcolors-contribute

A small website where anyone can build a colour palette from a photo of a bird
and submit it for the [birdcolors](https://github.com/bentonelli/birdcolors)
R package, and browse the palettes already in it.

- Contribute: https://bentonelli.github.io/birdcolors-contribute/
- Browse palettes: https://bentonelli.github.io/birdcolors-contribute/palettes.html

This repository is separate from the package on purpose: nothing here is part
of the R package, and changes here never affect its code, builds, CRAN
submissions or GitHub history.

```
docs/      the website (plain HTML/CSS/JS, no build step), served by GitHub Pages
backend/   Code.gs: Google Apps Script that saves submissions to a Google Sheet
```

How it fits together:

- The contributor's photo is processed entirely in their browser and is never uploaded.
- Submissions (name, anonymous choice, bird, hex colours, photo credit) are
  sent to the Apps Script and saved as one row per palette in your Google Sheet.
  Contributors who tick "Stay anonymous" don't have to give a name.
- Both pages read `R/base_colors.R` from the birdcolors repo on GitHub
  (`docs/palettes-data.js`): the contribute page to warn about duplicates, the
  browse page to list every palette. They only read that file, so new palettes
  appear on the browse page as soon as they're pushed to the package (GitHub
  may cache the file for a few minutes). If the file moves or changes shape,
  those features stop working and nothing else breaks.
- New palettes reach the package only when you paste them into
  `bird_palettes` in `R/base_colors.R` yourself.

## Try it locally

```bash
python3 -m http.server 8765 --directory docs
```

Then open http://127.0.0.1:8765/. Opening `index.html` straight from Finder
won't work properly, because browsers block parts of the page for local files.

## One-time setup (about 15 minutes)

1. **Create the sheet.** In Google Drive, create a new Google Sheet, e.g.
   "birdcolors submissions". You don't need to add any columns; the script
   creates a `Submissions` tab with headers on first use.
2. **Add the script.** In the sheet, open **Extensions → Apps Script**. Delete
   the placeholder code and paste in the contents of
   [`backend/Code.gs`](backend/Code.gs).
   - Optional: set `NOTIFY_EMAIL` to the address that should get an email for
     each submission.
3. **Test it.** In the editor, pick `testSubmission` from the function menu and
   click **Run**. Google will ask you to authorize the script. It should list
   only two permissions: viewing and managing *the spreadsheet this app is
   installed in*, and sending email as you (used only if `NOTIFY_EMAIL` is set).
   If it asks for *all* your spreadsheets, the `@OnlyCurrentDoc` line near the
   top of the script is missing. Because
   it's your own unverified script, you'll see an "unverified app" screen; choose
   **Advanced → Go to (project name)**. Check that a test row appeared, then
   delete it.
4. **Deploy.** Click **Deploy → New deployment**, choose type **Web app**, and set:
   - *Execute as*: **Me**
   - *Who has access*: **Anyone** (this is what lets the public page post to it;
     visitors don't need a Google account and can't see the sheet)

   Click **Deploy** and copy the **Web app URL** (ends in `/exec`).
5. **Connect the site.** Paste that URL into `SUBMIT_URL` at the top of
   [`docs/app.js`](docs/app.js), then commit and push.
6. **Publish the site.** In this repo on GitHub, go to **Settings → Pages →
   Build and deployment → Deploy from a branch**, and choose branch `main`,
   folder `/docs`. The site will be at
   `https://bentonelli.github.io/birdcolors-contribute/`.
7. **Check it end to end.** Submit a test palette from the live site, confirm the
   row appears in the sheet, then delete the row.

## Updating the script later

After editing the code in Apps Script, use **Deploy → Manage deployments →
(edit) → Version: New version → Deploy**. This keeps the same URL. Creating a
*new deployment* instead gives you a new URL that you'd have to paste into
`docs/app.js` again.

## Reviewing submissions

Each row has a `status` column (starts as `new`) you can change to `added` or
`rejected`. The `r_code` column is ready to paste into `bird_palettes` in the
package's `R/base_colors.R`. It's rebuilt on the server from the submitted
colours, so it's always well-formed.

To update `leaderboard()`, count `added` rows per contributor name, leaving out
rows where `anonymous` is `yes`. In the sheet, a pivot table on `first_name` +
`last_name` filtered to `status = added` and `anonymous = no` does this.

Rows are written by column name, so you can reorder, hide or delete columns
in the sheet without breaking anything. If the script gains a new field, its
column is added at the end automatically.

## Spam protection

- A hidden "honeypot" form field: bots that fill it get a fake success and nothing is saved.
- Server-side validation: names required, 2–9 valid hex colours, known palette types, length limits.
- A global cap of `MAX_PER_HOUR` submissions per hour.
- Cells starting with `= + - @` are prefixed with `'` so they can't run as formulas.

If spam gets through anyway, the simplest next step is to add Cloudflare
Turnstile or hCaptcha to the form.
