# Library

Kristian Bjørnard's design library at https://library.wjerk.shop: every book
as a spine on one A–Z bookcase, drawn to scale, in kit tints and thirteen
open-source typefaces. Click a spine for its card.

SvelteKit + Tailwind + Wjerk `kit.css`, every page prerendered, served from a
Cloudflare Worker.

## Update the books

The books live in Notion ("📚 The Library of KB"). The site is built from a
snapshot of it, `src/lib/data/library.json`, which is kept in git.

    node scripts/data.mjs      # Notion → library.json (needs NOTION_TOKEN in .env)
    npm run build              # check it builds
    git commit -am "Update books" && git push

`data.mjs` also looks up page counts and sizes on Open Library by ISBN,
cached in `data/openlibrary.json`. Without a token it builds from the small
seed in `data/seed/`.

A GitHub Action (`.github/workflows/notion-sync.yml`) does the same every
night at about 3–4 a.m. Eastern and commits only when Notion changed; run it
by hand from the Actions tab. It needs the `NOTION_TOKEN` repository secret.

## Add books

    npm run add -- 9780262019842 0195019199          # ISBN-10 or -13, typed or scanned
    npm run add -- 9780262019842 --where "GD Office"  # set Where
    npm run add -- … --dry-run                       # show, change nothing

Looks each one up on Open Library and creates the Notion page, reusing
existing author and publisher pages. It won't add a book that's already
there, by ISBN or by a matching title (then it points at the existing page);
`--force` overrides. A book needs a publisher: from Open Library, or
`--publisher "…"`. When Open Library doesn't know the book, add `--title "…"`.

## Fill in what's missing

    npm run fill                 # writes FILL-PLAN.md: what it would add
    npm run fill -- --apply      # writes exactly that plan to Notion

Fills only empty Subtitle, Year, Author, Publisher and LOC Call Number
fields from Open Library, by ISBN-13; never changes what you typed. To leave
a change out, delete it from `data/fill-plan.json` before applying.

In Notion, the **🔎 Needs info** view lists books missing an ISBN-13,
author, publisher or year; **📏 To measure** lists books without caliper
measurements, A–Z like the shelves.

## In Notion

- **ISBN-13** (text) is the ISBN the site uses. The old number **ISBN**
  column is only a fallback.
- **Height (mm)** and **Thickness (mm)**: caliper measurements. A measured
  book is drawn at its real size.
- **Format**: blank or Book, Film (drawn as a DVD case), Journal, Zine.
  Only books get Bookshop.org and Open Library links.
- **Personal Notes** shows on the book's card.

`node scripts/isbn-fixes.mjs` writes `ISBN-FIXES.md` (not in git): every
book whose ISBN needs fixing, with Open Library's suggestion.

## Bookshop.org

Links use affiliate ID 129137 (`src/lib/library.ts`); the card shows a
one-line disclosure.

## Design notes

Shelves, spines, tints and faces are in `src/routes/layout.css`, with the
reasoning in comments. Findings that matter beyond this site are in
`~/Code/color-system-and-guidelines/NOTES.md` (2026-11-26).
