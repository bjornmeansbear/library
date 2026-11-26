// Writes ISBN-FIXES.md: every book whose old number ISBN didn't survive
// cleanup, with a suggested ISBN from Open Library and how sure it is.
//
//   node scripts/isbn-fixes.mjs
//
// "Likely" means Open Library has an ISBN for that title within two digits
// of the one in Notion: almost certainly a typo. Anything else needs your
// eyes, since a work has many editions and only you know which is yours.
import fs from 'node:fs';

const token = fs.readFileSync('.env', 'utf8').match(/NOTION_TOKEN\s*=\s*"?([^"\n]+)/)[1];
const H = { Authorization: `Bearer ${token}`, 'Notion-Version': '2025-09-03', 'Content-Type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function all(ds) {
	const out = [];
	let c;
	do {
		const r = await (await fetch(`https://api.notion.com/v1/data_sources/${ds}/query`, { method: 'POST', headers: H, body: JSON.stringify({ page_size: 100, start_cursor: c }) })).json();
		out.push(...r.results);
		c = r.has_more ? r.next_cursor : undefined;
	} while (c);
	return out;
}
const text = (p) => (p?.title ?? p?.rich_text ?? []).map((t) => t.plain_text).join('').trim();
const titleOf = (p) => text(Object.values(p.properties).find((x) => x.type === 'title'));

const people = new Map((await all('dcabd07d-b2e1-4af3-a0cc-51ed47cc1678')).map((p) => [p.id, titleOf(p)]));
const pubs = new Map((await all('9027a079-5e5d-44c5-a5aa-a5b3abfd441a')).map((p) => [p.id, titleOf(p)]));
const books = await all('f4d45ea0-fcaf-44cb-a488-5a3e6ba3537f');

const todo = books
	.filter((p) => p.properties.ISBN?.number != null && !text(p.properties['ISBN-13']))
	.map((p) => ({
		title: titleOf(p),
		url: p.url,
		old: String(p.properties.ISBN.number),
		authors: (p.properties.Author?.relation ?? []).map((r) => people.get(r.id)).filter(Boolean),
		publisher: (p.properties.Publisher?.relation ?? []).map((r) => pubs.get(r.id)).filter(Boolean)[0] ?? '',
		year: text(p.properties.Year)
	}))
	.sort((a, b) => a.title.localeCompare(b.title));

// Not books: films (their numbers are barcodes) and a journal (ISSN).
const NOT_BOOKS = /^(I Heart Huckabees|Who Killed the Electric Car\?|Helvetica)$|^Codex:/;

function valid13(s) { let t = 0; for (let i = 0; i < 13; i++) t += Number(s[i]) * (i % 2 ? 3 : 1); return /^\d{13}$/.test(s) && t % 10 === 0; }
function valid10(s) { if (!/^\d{9}[\dX]$/.test(s)) return false; let t = 0; for (let i = 0; i < 10; i++) t += (s[i] === 'X' ? 10 : Number(s[i])) * (10 - i); return t % 11 === 0; }
function to13(s10) { const c = '978' + s10.slice(0, 9); let t = 0; for (let i = 0; i < 12; i++) t += Number(c[i]) * (i % 2 ? 3 : 1); return c + ((10 - (t % 10)) % 10); }
function lev(a, b) {
	const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
	for (let j = 1; j <= b.length; j++) d[0][j] = j;
	for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
		d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
	return d[a.length][b.length];
}

async function search(b) {
	const q = new URLSearchParams({ title: b.title.replace(/[:|].*$/, '').trim(), fields: 'key,title,author_name,isbn,first_publish_year', limit: '5' });
	if (b.authors[0]) q.set('author', b.authors[0]);
	try {
		const r = await fetch(`https://openlibrary.org/search.json?${q}`, { headers: { 'User-Agent': 'library-site-build (static site generator)' } });
		await sleep(400);
		return r.ok ? (await r.json()).docs : [];
	} catch { return []; }
}

const rows = [];
for (const b of todo) {
	if (NOT_BOOKS.test(b.title)) { rows.push({ ...b, verdict: 'not-a-book' }); continue; }
	const docs = await search(b);
	const isbns = new Set();
	for (const d of docs) for (const i of d.isbn ?? []) {
		if (valid13(i)) isbns.add(i);
		else if (valid10(i)) isbns.add(to13(i));
	}
	const digits = b.old.replace(/\D/g, '');
	let best = null;
	if (digits.length > 5) {
		for (const i of isbns) {
			const dist = Math.min(lev(digits, i), lev(digits, i.slice(3)));
			if (!best || dist < best.dist) best = { isbn: i, dist };
		}
	}
	const work = docs[0] ? `https://openlibrary.org${docs[0].key}` : null;
	if (best && best.dist <= 2) rows.push({ ...b, verdict: 'likely', isbn: best.isbn, work });
	else rows.push({ ...b, verdict: isbns.size ? 'choose' : 'not-found', count: isbns.size, work });
}

const link = (b) => `[${b.title}](${b.url})`;
const who = (b) => [b.authors.join(', '), b.publisher, b.year].filter(Boolean).join(' · ');
const likely = rows.filter((r) => r.verdict === 'likely');
const choose = rows.filter((r) => r.verdict === 'choose');
const missing = rows.filter((r) => r.verdict === 'not-found');
const notBooks = rows.filter((r) => r.verdict === 'not-a-book');

const md = `# ISBN fix list

Generated ${new Date().toISOString().slice(0, 10)} by \`node scripts/isbn-fixes.mjs\`. Each title links to its Notion page.
Fix a book by typing the right 13-digit number into its **ISBN-13** column. Re-run the script to refresh this list.

## 1. Probably typos (${likely.length})

Open Library has an ISBN for the same title within two digits of what's in Notion. Check the number on the book's copyright page; if it matches, these can all be written in one go — tell Claude "apply the likely ISBNs".

| | Book | In Notion | Suggested |
|---|---|---|---|
${likely.map((r) => `| ☐ | ${link(r)}<br>${who(r)} | ${r.old} | **${r.isbn}** |`).join('\n')}

## 2. Pick your edition (${choose.length})

Open Library knows the book but not which edition is yours. Find the ISBN on your copy's copyright page (or the back cover barcode), or browse the editions at the link.

| | Book | In Notion | Editions |
|---|---|---|---|
${choose.map((r) => `| ☐ | ${link(r)}<br>${who(r)} | ${r.old} | ${r.count} ISBNs · [Open Library](${r.work}) |`).join('\n')}

## 3. Not found on Open Library (${missing.length})

Check the copyright page. Older books (before about 1970) often have no ISBN at all — then just clear the old ISBN column.

| | Book | In Notion |
|---|---|---|
${missing.map((r) => `| ☐ | ${link(r)}<br>${who(r)} | ${r.old} |`).join('\n')}

## 4. Not books (${notBooks.length})

Films carry a barcode, not an ISBN, and a journal has an ISSN. Clear the ISBN column for these; the site doesn't need one.

${notBooks.map((r) => `- ☐ ${link(r)} — ${r.old}`).join('\n')}
`;
fs.writeFileSync('ISBN-FIXES.md', md);
fs.writeFileSync('data/isbn-fixes.json', JSON.stringify(rows, null, '\t') + '\n');
console.log(`likely ${likely.length}, choose ${choose.length}, not found ${missing.length}, not books ${notBooks.length} → ISBN-FIXES.md`);
