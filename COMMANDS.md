# Commands

Everything that's just "run a script". Run from `~/Code/library` unless it
says otherwise. Save Claude for new code.

## The library site

| To | Run |
|---|---|
| Pull Notion into the site | `npm run sync` |
| See what changed | `git status` and `git diff --stat` |
| Publish (deploys library.wjerk.shop in a minute or two) | `git add -A && git commit -m "Data: …" && git push` |
| Look at the site on this computer | `npm run dev`, then open the address it prints |

The usual after adding books in Notion or on /scan:

    npm run sync && git add src/lib/data/library.json && git commit -m "Data: new books" && git push

## Adding books

| To | Run |
|---|---|
| From the phone | library.wjerk.shop/scan |
| From the laptop, by ISBN (a USB scanner types the number) | `npm run add -- 9780262019842` |
| Several, with where they live | `npm run add -- 978… 978… --where "GD Office"` |
| See what it would add, change nothing | `npm run add -- 978… --dry-run` |

## Filling in missing details

| To | Run |
|---|---|
| Plan missing authors, publishers, years from Open Library | `npm run fill` (writes FILL-PLAN.md) |
| Apply that plan | `npm run fill -- --apply` |
| Find missing sizes and pages | `npm run sizes` |
| Fill them | `npm run sizes -- --apply` |
| List ISBNs that look wrong | `npm run isbn-fixes` (writes ISBN-FIXES.md) |
| Plan tags | `npm run tags` |

## A Library, the book (`~/Code/library/book`)

`bjook` is `~/Code/bjook/bjook` (or set `alias bjook=~/Code/bjook/bjook`).

| To | Run (in `book/`) |
|---|---|
| Build every PDF | `bjook build` |
| Live preview of the spreads while editing | `bjook watch`, then open the address it prints |
| Keep a dated proof | `bjook build --snap "what changed"` |
| Republish the page on bjornmeansbook.com | `bjook site --out ~/Code/bjornmeansbook` |
| …then, in `~/Code/bjornmeansbook` | `git add a-library index.html bjook.css && git commit -m "Update A Library" && git push` |

Sync first if books were added, so the book has them:
`cd ~/Code/library && npm run sync && cd book && bjook build`

The words are in `essay.md`, `colophon.md`, `cover.md`, `running.txt`;
settings in `book.toml`. Files land in `book/build/`:
`a-library.pdf` (to look at), `a-library-spreads.pdf` (to share),
`a-library-french-fold-black.pdf` and `-green.pdf` (riso masters),
`a-library-cover-riso.pdf` (cover master), `a-library-cover-look.pdf`.

## The /scan page's secrets

Set once; only again if the token or passphrase changes:

    npx wrangler secret put NOTION_TOKEN
    npx wrangler secret put SCAN_KEY
