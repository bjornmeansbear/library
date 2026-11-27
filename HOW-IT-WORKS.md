# How this works

Six boxes, left to right. A book you type into Notion passes through each one
on its way to library.wjerk.shop. When something breaks, the first question is
always *which box?*

```
 Notion ──▶ data.mjs ──▶ library.json ──▶ SvelteKit build ──▶ GitHub ──▶ Cloudflare
 (you type)  (fetches)    (a snapshot)     (makes the pages)   (stores)   (serves)
```

## 1. Notion: where the books live

"📚 The Library of KB" is the only place you edit books. Authors, publishers
and tags are separate databases, linked to books by *relations*.

The site reaches Notion through a **connection** called `wjerk-sync`. A
connection is a key with permissions: it can only see the databases you've
shared with it (••• → Connections on a database). The key itself is the
`NOTION_TOKEN` in `.env`, a file that never goes into git because whoever has
it can edit your Notion.

**Looks broken when:** a book is in Notion but never shows up (that database
isn't shared with `wjerk-sync`), or tags are missing (the Tags database
isn't shared yet).

## 2. `scripts/data.mjs`: the fetcher

A Node script: JavaScript that runs on a computer rather than in a browser.
It asks Notion for every book, cleans up ISBNs, looks up page counts and sizes
on Open Library, picks each spine's tint and typeface, and writes it all to
one file. Run it by hand with `npm run sync`.

`npm run …` is shorthand: the names are listed under `"scripts"` in
`package.json`, each standing for a longer command.

Its helpers sit next to it: `scripts/lib/notion.mjs` (talking to Notion),
`scripts/lib/openlibrary.mjs` (talking to Open Library),
`scripts/lib/sizes.mjs` (the Library of Congress catalog, for heights and
page counts). The other scripts, `add`, `fill`, `sizes`, `tags` and
`isbn-fixes`, use the same helpers but write *into* Notion instead of
reading out of it. The careful ones (`fill`, `tags`) write a plan file
first and only change Notion when run with `--apply`.

It also reads `data/bjornpaedia.json`: each book's page on
bjornpaedia.wjerk.shop, when the wiki has one, which becomes the "My notes on
bjornpaedia" link on the book. That file is written from the other side, by
`sad2021tw/scripts/library-links.py` in the sentence-a-day repo, which also
puts a "Library" row on the wiki's matching book and author pages. Run it
there after adding books here or source pages there, then commit the file
here; the nightly sync picks it up.

**Looks broken when:** `npm run sync` prints an error in red. Read the last
line; it usually names the field or book it choked on.

## 3. `src/lib/data/library.json`: the snapshot

A plain text file holding every book as data: title, author, height in inches,
tint, face. Open it and you can read it. The website never talks to Notion
directly; it only ever reads this file. That's why the site is fast and why
Notion being slow or down never takes the site down.

It's kept in git on purpose, so every change to your books is a commit you can
look back on.

## 4. The SvelteKit build: making the pages

`npm run build` turns code plus the snapshot into finished HTML pages, one for
the bookcase and one per book (*prerendering*). The code:

| To change… | Look in |
|---|---|
| Shelves, boards, spine colors and faces | `src/routes/layout.css` |
| One spine's markup | `src/lib/Spine.svelte` |
| The book card (links, details) | `src/lib/BookCard.svelte` |
| The popup around the card | `src/lib/BookDialog.svelte` |
| The home page: header, search, filters, footer | `src/routes/+page.svelte` |
| A book's own page | `src/routes/book/[slug]/+page.svelte` |
| Wjerk tokens (colors, type) | `src/lib/kit.css`, copied from the design repo; don't edit here |

A `.svelte` file is HTML with a little JavaScript in `<script>` at the top and
CSS that only applies to that file in `<style>` at the bottom. Tailwind
classes (`px-2`, `text-sm`) are shorthand CSS written in the markup; they're
mapped to kit.css tokens at the top of `layout.css`.

To try a change locally: `npm run dev`, then open the address it prints.
The page reloads as you save.

**Looks broken when:** `npm run build` fails. The error names a file and line.

## 5. GitHub: the record

`git` keeps every version of every file. A **commit** is one saved step with a
message; **push** sends your commits to GitHub (bjornmeansbear/library), which
keeps the public copy. `git log --oneline` lists the steps.

GitHub also runs the **nightly sync** (`.github/workflows/notion-sync.yml`):
around 3–4 a.m. Eastern, a borrowed computer does box 2, and if the snapshot
changed it commits and pushes. It uses a copy of the Notion key stored as a
GitHub *secret*. Run it by hand from the repo's Actions tab.

**Looks broken when:** the Actions tab shows a red ✗. Click it for the log.

## 6. Cloudflare: serving the site

Every push to GitHub starts a **build** on Cloudflare (Workers Builds): it
does box 4 on Cloudflare's computers, then publishes the result to the Worker
`wjerk-library` in the OOKB account, which answers at library.wjerk.shop. The
settings for that live in `wrangler.jsonc`. `npx wrangler deploy` does the same
by hand from your machine.

**Looks broken when:** the site doesn't change after a push. In GitHub, the
commit gets a red ✗ beside it; in Cloudflare, Workers & Pages → wjerk-library
→ Deployments shows the failed build and its log.

## The whole trip, for one edit

You fix a typo in Notion. That night GitHub's sync fetches it (box 2), sees
the snapshot changed (3), commits and pushes (5). The push tells Cloudflare,
which builds (4) and publishes (6). Next morning it's live. Nothing to run.

In a hurry: `npm run sync`, then `git commit -am "Update books"` and
`git push`. Live in about two minutes.

## Words you'll meet

- **Build:** turning source code into the files a browser gets.
- **Deploy:** putting those files where people can reach them.
- **Repo:** a project folder under git; this one is a repo.
- **Environment variable / `.env`:** a setting (often a secret key) kept
  outside the code so it isn't shared with the code.
- **API:** the way one program asks another for data. Notion, Open Library
  and Cloudflare each have one.
- **Worker:** Cloudflare's name for a small program running on their servers;
  this one mostly hands out the prebuilt pages.
- **Node / npm:** Node runs JavaScript on your computer; npm installs the
  packages it needs (into `node_modules`, never edited by hand).
