# Commands

How to run the library without calling for help: each task as steps, with
what you should see after each one and what to do next. Written for anyone
helping (an assistant, a colleague, Kristian on a tired day) who's at home
in a terminal but new to this repo.

## How it fits together

- **Notion** is where the books live. Every change to a book (title, author,
  ISBN, where it is) happens there, by hand or by one of the scripts below.
- **This repo** (`~/Code/library`) turns Notion into the site,
  library.wjerk.shop. `npm run sync` copies Notion into one file,
  `src/lib/data/library.json`; the site only ever reads that file.
- **Pushing to GitHub publishes.** Cloudflare rebuilds the site on every
  push to `main`, in a minute or two.
- **A nightly sync** (GitHub, about 3–4 a.m.) does the sync-and-push by
  itself. If nothing's urgent, change Notion and wait for morning.
- **The book**, *A Library*, is built from the same file, in `book/`.

Run everything from `~/Code/library` unless a step says otherwise. Scripts
that change Notion all work the same way: run them plain to see a plan
(nothing changes), read it, then run again with `--apply`.

## Before you start (once per computer)

1. Node 24 or newer: `node --version`. Then `npm install`.
2. A `.env` file in `~/Code/library` with one line:
   `NOTION_TOKEN="secret_…"`. Ask Kristian for the token. Never commit
   `.env` (git already ignores it). Without it, scripts stop with
   "NOTION_TOKEN is not set".
3. For the book only:
   ```
   brew install pipx pandoc poppler
   pipx install weasyprint && pipx inject weasyprint pypdf
   alias bjook=~/Code/bjook/bjook        # put this in ~/.zshrc to keep it
   ```
4. For the bjornpaedia links only: Python 3 (`python3 --version`) and the
   `~/Code/sentence-a-day` and `~/Code/bjornpaedia` repos next to this one.

---

## Get new or changed books onto the site

Use this after adding books (by scan or in Notion) or fixing anything in
Notion, when you don't want to wait for the nightly sync.

1. `npm run sync`
   - **You'll see** one line, after a minute or so:
     `Notion: 501 books, 11 shelves, sized: {…} → src/lib/data/library.json`
   - **If it prints a red error**, read the last line; it usually names the
     book or field it choked on. Fix that book in Notion and run it again.
2. `git status`
   - **You'll see** `src/lib/data/library.json` modified (and maybe
     `data/openlibrary.json`, the lookup cache: commit it too).
   - **If nothing changed**, the site already has everything. Stop here.
3. `git add -A && git commit -m "Data: new books" && git push`
4. Wait two minutes, then open library.wjerk.shop and look for the book.

## Add books

**From the phone:** library.wjerk.shop/scan. Scan the barcode, pick where
it lives and the shelf, done. It goes straight into Notion.

**From the laptop**, by ISBN (a USB barcode scanner types the number):

1. `npm run add -- 9780262019842 --dry-run` to check first (optional).
   - **You'll see** `○ 9780262019842 would add “Speculative Everything” …`
2. `npm run add -- 9780262019842` (several ISBNs in one command are fine;
   add `--where "GD Office"` to set where they live).
   - **You'll see** `+ 978… added “Title” …` and the Notion link for each.
   - **`? … looks like it's already here as “…”`** means a book with that
     title exists with a different ISBN. Usually it's the same book: put the
     new ISBN in that page's ISBN-13 field in Notion instead of adding.
   - **A book nobody knows** goes in as "ISBN 978…". Give it a name with
     `--title "…"` (and `--publisher "…"`), or rename it in Notion.
3. Then **Get new or changed books onto the site** (above).

## Fill in missing details

### Authors, publishers, years, subtitles

1. `npm run fill`
   - **You'll see** `plan: N books (…)` and it writes `FILL-PLAN.md`.
2. Read `FILL-PLAN.md`. Names marked "(new)" will create a new author or
   publisher page: check those are spelled right and aren't a variant of
   one that exists. To skip a change, delete it from `data/fill-plan.json`.
3. `npm run fill -- --apply`
   - **You'll see** `Wrote details to N books in Notion.`
4. Then **Get new or changed books onto the site**.

It only fills empty fields; it never overwrites what's typed. For a field
that's filled in wrong, see **Fix typos**.

### Page counts and sizes (for the spines)

1. `npm run sizes`
   - **You'll see** a line per book (`○ Title · 224 pp, 9.0 in…`), then
     `Would write N books: heights from Open Library …`.
2. Look the list over, then `npm run sizes -- --apply`
   - **You'll see** the same lines with `✓`.
3. Then **Get new or changed books onto the site**.

A real measurement beats both catalogs: type it into Height or Thickness
in Notion and set "Size from" to Measured.

### ISBNs that look wrong

1. `npm run isbn-fixes`
   - **You'll see** `likely N, choose N, not found N, not books N →
     ISBN-FIXES.md`.
2. Read `ISBN-FIXES.md`. "Likely" ones are almost certainly typos; "choose"
   ones need someone holding the book, since only the copy says which
   edition it is.
3. Fix them in Notion's ISBN-13 field, or for a book with no ISBN at all,
   add an `isbn:` line to `fixes.txt` (see **Fix typos**).

## Fix typos

Notion was typed by hand, so names and titles have typos. Two commands:
one finds likely typos, the other fixes them from a list.

1. `npm run typos` (offline, about a second; run `npm run sync` first so it
   reads the latest)
   - **You'll see** `N to check.` and lines like
     `title: Enviornment → Environment   # maybe; in How to See…`
   - Lines marked "maybe" are guesses: names and foreign words ("Natur",
     "Futura") show up too. Keep only the real typos.
   - **A word that's right where it is**: add `ok: Natur in Natur und Bauen`
     to `fixes.txt` (the word, then the start of that book's title). It stops
     being listed in that book only; anywhere else it's still checked.
   - **`Nothing looks wrong.`** means you're done.
   - **It can't see** a misspelled name on someone's only book ("Alvia
     Toffler"): nothing to compare it against. Catch those by reading.
2. Copy the real ones into `fixes.txt` (the notes at its top explain the four
   kinds of line: `person:`, `publisher:`, `title:`, `isbn:`). For odd
   punctuation it prints `→ ?`: write the right text in place of the `?`.
3. `npm run fix`
   - **You'll see** each change with the books it touches, e.g.
     `· person: "Steve King" → "Steve Krug" (Don't Make Me Think…)`, then
     `N changes to make, N already done.`
   - **Read the books listed.** If a name links to a book by someone else
     with the same name, don't apply: fix that one by hand in Notion.
   - `? no person named …` means the name in the file doesn't match Notion
     exactly; copy it from Notion.
4. `npm run fix -- --apply`
   - **You'll see** the same lines with `✓`, then `Now npm run sync.`
   - A person or publisher whose right spelling already has its own page
     gets merged into it; the misspelled page goes to Notion's trash
     (restorable for 30 days).
5. Then **Get new or changed books onto the site**.

Leave fixed lines in `fixes.txt` as a record: running it again just reports
them "already done".

## Tag books onto shelves

1. `npm run tags`
   - **You'll see** `N sure, N maybe → TAG-PLAN.md` and a count per shelf.
2. Read `TAG-PLAN.md`. Maybes are numbered.
3. `npm run tags -- --apply` adds the sure ones; add `--maybe 3,7,12` for
   chosen maybes, or `--maybe all`.
   - **You'll see** `Tagged N books.`
4. Then **Get new or changed books onto the site**.

## Link books with bjornpaedia, both ways

Each book card on the site can say "My notes on bjornpaedia", and each
book or author page on bjornpaedia.wjerk.shop gets a "Library" row
pointing back. One script makes both. Run it after new books arrive here
or new book/author pages are written there.

1. `cd ~/Code/sentence-a-day && python3 sad2021tw/scripts/library-links.py --dry-run`
   - **You'll see** `linked Title` for each new link, `isbn Title ← 978…`
     where a wiki page matched by title gets the library's ISBN, and
     `by title …` for matches with no ISBN on either side: check those by
     eye.
2. Run it again without `--dry-run`.
   - **You'll see** `done: N book tiddlers and N people linked …` and
     `-> ~/Code/library/data/bjornpaedia.json`.
3. Publish the wiki: `bash publish.sh` (in `~/Code/sentence-a-day`). It
   builds, shows what changed, and asks `Commit and push bjornpaedia? [y/N]`:
   type `y`.
4. If step 1 listed new pages that weren't on bjornpaedia yet, run step 2
   once more now that they are (the library only links to published pages).
5. Commit the wiki's changes: `git add -A && git commit -m "Library links" && git push`.
6. Back in `~/Code/library`: `npm run sync`, then commit and push (the sync
   reads `data/bjornpaedia.json` into the site).

## A Library, the book

The book is in `book/`. Its words are `essay.md`, `colophon.md`,
`cover.md` and `running.txt`; its settings are `book.toml`.

### Build it

1. Get the latest books first: `npm run sync`.
2. `cd book && bjook build`
   - **You'll see** `46 pages: 501 books on 16 shelves, 20 in the second
     ink …` and a list of files, all in `book/build/`.
   - **`[shelf] second_spines: no book with the slug …`** means a green
     spine's book was renamed or removed: see **Green spines**.
3. Open `book/build/a-library.pdf` to look it over.

| File in `book/build/` | What it's for |
|---|---|
| `a-library.pdf` | the book page by page, with the green as it'll look |
| `a-library-spreads.pdf` | the same as spreads, to read on screen or share |
| `a-library-french-fold-black.pdf` | riso master, black drum: one leaf a sheet, French fold |
| `a-library-french-fold-green.pdf` | riso master, green drum, same sheets |
| `a-library-cover-riso.pdf` | the cover master (gold ink on black paper) |
| `a-library-cover-look.pdf` | how the cover will look |

`bjook watch` rebuilds as you edit and shows the spreads in the browser.
`bjook build --snap "what changed"` keeps a dated copy of a proof.

### Green spines

Books the essay names print with a green block under the spine. They're
listed by slug in `book/book.toml`, under `second_spines`.

1. Find a book's slug:
   `grep -o '"slug": "[^"]*gerstner[^"]*"' src/lib/data/library.json`
   (put a word from the title in place of `gerstner`).
   - **You'll see** `"slug": "karl-gerstner"`.
2. Add it to the `second_spines` list in `book/book.toml`, in quotes,
   followed by a comma.
3. Build (above). The summary counts the green spines.

A slug comes from the Notion title, so renaming a book in Notion changes
its slug: the build stops and names it, and the list needs the new one.

### Put it on bjornmeansbook.com

1. `cd book && bjook site --out ~/Code/bjornmeansbook`
2. `cd ~/Code/bjornmeansbook && git add a-library index.html bjook.css && git commit -m "Update A Library" && git push`
   (only those files: anything else changed there isn't this book's).

## The /scan page's secrets

Set once, and again only if the Notion token or the scan passphrase changes:

    npx wrangler secret put NOTION_TOKEN
    npx wrangler secret put SCAN_KEY

## When something goes wrong

| You see | It means | Do |
|---|---|---|
| `NOTION_TOKEN is not set` | no `.env`, or it's in the wrong folder | **Before you start**, step 2 |
| `Notion 401` | the token is wrong or was revoked | get a new one from Kristian |
| `Notion 429` that doesn't go away | Notion's rate limit | wait a minute, run it again |
| `pandoc isn't installed` | the book's setup isn't done | **Before you start**, step 3 |
| `bjook: command not found` | no alias | `alias bjook=~/Code/bjook/bjook` |
| the site didn't change after a push | Cloudflare is still building, or the build failed | wait two minutes; then check the repo's latest commit on GitHub for a red ✗ |
| a book is missing from the site | not synced yet, or its Notion page has no title (the sync skips those) | give it a title; **Get new or changed books onto the site** |
