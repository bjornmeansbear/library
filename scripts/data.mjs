// Builds src/lib/data/library.json, the only data the site reads.
//
//   node scripts/data.mjs            Notion if NOTION_TOKEN is set, else the seed
//   node scripts/data.mjs --seed     always the seed in data/seed/
//
// Three steps:
//   1. read   Notion (or data/seed/*.txt) into plain records
//   2. look up page counts and sizes on Open Library, by ISBN, cached in
//      data/openlibrary.json so a rebuild only asks about new books
//   3. clean up and write library.json
//
// Private fields (Borrower, On loan, Personal Rating, the email-notes link,
// PDFs) are never read, so they can't end up on the site.

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'src/lib/data/library.json');
const cachePath = path.join(root, 'data/openlibrary.json');

loadEnv(path.join(root, '.env'));
const useSeed = process.argv.includes('--seed') || !process.env.NOTION_TOKEN;

const cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf8')) : {};

async function main() {
	const raw = useSeed ? readSeed() : await readNotion();
	const library = await build(raw, cache);
	fs.writeFileSync(cachePath, JSON.stringify(cache, null, '\t') + '\n');
	fs.mkdirSync(path.dirname(out), { recursive: true });
	// Keep the old date when nothing else changed, so the nightly sync
	// doesn't commit (and redeploy) just because a day went by.
	if (fs.existsSync(out)) {
		const prev = JSON.parse(fs.readFileSync(out, 'utf8'));
		const same = (o) => JSON.stringify({ ...o, generated: null });
		if (same(prev) === same(library)) library.generated = prev.generated;
	}
	fs.writeFileSync(out, JSON.stringify(library, null, '\t') + '\n');
	const measured = library.books.filter((b) => b.measured).length;
	console.log(
		`${useSeed ? 'seed' : 'Notion'}: ${library.books.length} books, ` +
			`${library.shelves.length} shelves, ${measured} spines at real size → ${path.relative(root, out)}`
	);
}

// ---------------------------------------------------------------- 1. read

function readSeed() {
	const lines = (f) =>
		fs
			.readFileSync(path.join(root, 'data/seed', f), 'utf8')
			.split('\n')
			.filter((l) => l && !l.startsWith('#'))
			.map((l) => l.split('|'));
	const ids = (s) => (s ? s.split(',') : []);
	const names = (f) => Object.fromEntries(lines(f).map(([id, name]) => [id, name]));
	return {
		people: names('people.txt'),
		publishers: names('publishers.txt'),
		tags: {},
		books: lines('books.txt').map(([id, title, subtitle, authors, publishers, year, isbn, where, notes]) => ({
			id, title, subtitle, authors: ids(authors), publishers: ids(publishers),
			year, isbn, where, notes, tags: []
		})),
		shelves: lines('shelves.txt').map(([id, name, room, books]) => ({ id, name, room, books: ids(books) }))
	};
}

const DS = {
	books: 'f4d45ea0-fcaf-44cb-a488-5a3e6ba3537f',
	people: 'dcabd07d-b2e1-4af3-a0cc-51ed47cc1678',
	publishers: '9027a079-5e5d-44c5-a5aa-a5b3abfd441a',
	tags: 'e6a290b7-0f2d-4245-b942-d6425c840f73',
	shelves: '14a55aa2-8d71-8172-bfc8-000be9afab98'
};

async function notion(method, url, body) {
	for (let attempt = 0; ; attempt++) {
		const res = await fetch(`https://api.notion.com/v1/${url}`, {
			method,
			headers: {
				Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
				'Notion-Version': '2025-09-03',
				'Content-Type': 'application/json'
			},
			body: body && JSON.stringify(body)
		});
		if (res.status === 429 && attempt < 5) {
			await sleep(Number(res.headers.get('retry-after') ?? 1) * 1000);
			continue;
		}
		if (!res.ok) throw new Error(`Notion ${res.status} on ${url}: ${await res.text()}`);
		return res.json();
	}
}

async function queryAll(dataSource) {
	const pages = [];
	let cursor;
	do {
		const r = await notion('POST', `data_sources/${dataSource}/query`, { page_size: 100, start_cursor: cursor });
		pages.push(...r.results);
		cursor = r.has_more ? r.next_cursor : undefined;
	} while (cursor);
	return pages;
}

// A page's relation list stops at 25 entries; past that, ask for the rest.
async function relation(page, name) {
	const prop = page.properties[name];
	if (!prop) return [];
	if (!prop.has_more) return prop.relation.map((r) => bare(r.id));
	const ids = [];
	let cursor;
	do {
		const q = cursor ? `?start_cursor=${cursor}` : '';
		const r = await notion('GET', `pages/${page.id}/properties/${prop.id}${q}`);
		ids.push(...r.results.map((x) => bare(x.relation.id)));
		cursor = r.has_more ? r.next_cursor : undefined;
	} while (cursor);
	return ids;
}

const text = (p) => (p?.title ?? p?.rich_text ?? []).map((t) => t.plain_text).join('').trim();
const titleOf = (page) => text(Object.values(page.properties).find((p) => p.type === 'title'));
const bare = (id) => id.replaceAll('-', '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readNotion() {
	const nameMap = async (ds) =>
		Object.fromEntries((await queryAll(ds)).map((p) => [bare(p.id), titleOf(p)]));
	const people = await nameMap(DS.people);
	const publishers = await nameMap(DS.publishers);
	// Tags is a workspace-wide database outside the Library page; the site
	// works without it.
	const tags = await nameMap(DS.tags).catch(() => {
		console.warn('Tags database not shared with the integration; building without tags.');
		return {};
	});

	const books = [];
	for (const p of await queryAll(DS.books)) {
		const pr = p.properties;
		books.push({
			id: bare(p.id),
			title: titleOf(p),
			subtitle: text(pr['Subtitle']),
			authors: await relation(p, 'Author'),
			publishers: await relation(p, 'Publisher'),
			tags: await relation(p, '🏷️ Tags'),
			year: text(pr['Year']),
			// The ISBN-13 text column (added 2026-11-26) wins; the old number
			// column is the fallback until every book has the text one.
			isbn: text(pr['ISBN-13']) || (pr['ISBN']?.number != null ? String(pr['ISBN'].number) : ''),
			where: pr['Where']?.select?.name ?? '',
			notes: text(pr['Personal Notes']),
			format: pr['Format']?.select?.name ?? '',
			heightMm: pr['Height (mm)']?.number ?? null,
			thicknessMm: pr['Thickness (mm)']?.number ?? null
		});
	}

	const shelves = [];
	for (const p of await queryAll(DS.shelves)) {
		const ids = await relation(p, '📚 The Library of KB');
		if (ids.length) {
			shelves.push({ id: bare(p.id), name: titleOf(p), room: p.properties['Room']?.select?.name ?? '', books: ids });
		}
	}
	return { people, publishers, tags, books, shelves };
}

// ------------------------------------------------------- 2. Open Library

async function lookUp(isbn) {
	if (isbn in cache) return cache[isbn];
	let found = null;
	try {
		const res = await fetch(`https://openlibrary.org/isbn/${isbn}.json`, {
			headers: { 'User-Agent': 'library-site-build (static site generator)' }
		});
		if (res.ok) {
			const d = await res.json();
			found = {
				pages: d.number_of_pages ?? null,
				dimensions: d.physical_dimensions ?? null
			};
		}
	} catch {
		return null; // offline: don't cache, ask again next time
	}
	cache[isbn] = found;
	await sleep(350);
	return found;
}

// "23.5 x 15.6 x 2.3 centimeters" or "9 x 6 x 1 inches" → inches, largest first
function inches(dimensions) {
	if (!dimensions) return null;
	const nums = (dimensions.match(/[\d.]+/g) ?? []).map(Number).filter((n) => n > 0);
	if (nums.length < 2) return null;
	const k = /cent/i.test(dimensions) ? 1 / 2.54 : /mill/i.test(dimensions) ? 1 / 25.4 : 1;
	return nums.map((n) => n * k).sort((a, b) => b - a);
}

// --------------------------------------------------------------- 3. build

async function build(raw, cache) {
	const slugs = new Set();
	const byId = new Map();

	for (const b of raw.books) {
		const title = cleanTitle(b.title);
		if (!title) continue;
		// Blank counts as Book. A film's or album's number is a barcode, not an ISBN.
		const format = (b.format || 'Book').toLowerCase();
		const isbn = format === 'film' || format === 'music' ? null : normalizeIsbn(b.isbn);
		const ol = isbn ? await lookUp(isbn.isbn13) : null;
		// Cases are fixed objects. DVD: 7.5 × 5.3 × 0.55 inches. CD jewel
		// case: 125 × 142 × 10.4 mm, standing on its 125 mm side.
		const CASES = { film: [7.5, 5.3, 0.55], music: [4.92, 5.59, 0.41] };
		const dims = CASES[format] ?? inches(ol?.dimensions);
		const h = hash(b.id);

		const book = {
			id: b.id,
			slug: uniqueSlug(slugify(title), slugs),
			title,
			format,
			subtitle: b.subtitle || null,
			authors: joinNames(b.authors.map((id) => raw.people[id]).filter(Boolean)),
			publishers: joinNames(b.publishers.map((id) => raw.publishers[id]).filter(Boolean)),
			tags: b.tags.map((id) => raw.tags[id]).filter(Boolean),
			year: /^\d{3,4}$/.test(b.year) && b.year !== '0' ? b.year : null,
			isbn10: isbn?.isbn10 ?? null,
			isbn13: isbn?.isbn13 ?? null,
			where: b.where || null,
			notes: b.notes || null,
			pages: ol?.pages ?? null,
			// Spine size in inches. Your caliper numbers in Notion win; then
			// Open Library's; otherwise a steady made-up size per book, so the
			// shelf is uneven the way a real one is.
			height: round(
				b.heightMm ? b.heightMm / 25.4 : (dims?.[0] ?? 7.5 + (h % 250) / 100)
			),
			thickness: round(
				b.thicknessMm
					? b.thicknessMm / 25.4
					: (dims?.[2] ??
							(ol?.pages ? 0.15 + ol.pages * 0.0025 : 0.45 + ((h >> 8) % 70) / 100))
			),
			measured: Boolean(b.heightMm && b.thicknessMm),
			sized: b.heightMm && b.thicknessMm ? 'measured' : dims ? 'open-library' : ol?.pages ? 'pages' : 'guessed',
			tint: TINTS[h % TINTS.length],
			shelf: null,
			position: null
		};
		byId.set(b.id, book);
	}

	const shelves = [];
	for (const s of raw.shelves) {
		const books = s.books.map((id) => byId.get(id)).filter(Boolean);
		if (!books.length) continue;
		books.forEach((b, i) => {
			b.shelf = s.name;
			b.position = i + 1;
		});
		shelves.push({ id: s.id, name: s.name, room: s.room || null, books: books.map((b) => b.slug) });
	}
	shelves.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));

	const books = [...byId.values()].sort((a, b) => sortKey(a.title).localeCompare(sortKey(b.title)));
	// One bookcase, every book in title order (the office shelves are filed
	// the same way), so colours are worked out along that single run.
	colour([books]);
	return { generated: new Date().toISOString().slice(0, 10), shelves, books };
}

// Every pale kit tint that keeps Wjerk Black text at AAA (7.15:1 and up),
// plus pink-3 at AA (6.30:1). Measured with contrast.py, 2026-11-26.
const HUES = ['red', 'orange', 'yellow', 'goldenrod', 'green', 'blue', 'cornflower', 'purple', 'pink', 'brown', 'gray'];
const TINTS = HUES.flatMap((hue) => [1, 2, 3].map((step) => `${hue}-${step}`));

// Spine colours, the way a real shelf looks:
//   - a series (same publisher, same first word: "Dirty Furniture 1…6",
//     "Codex…", "Are.na Annual…") is one colour, like a matched set;
//   - a publisher keeps its own hue across the library, lightness varies;
//   - two neighbours never share a hue unless they're the same series.
function colour(rows) {
	// "Dirty Furniture 3: Toilet" → "dirty furniture", "Are.na Annual 2022" →
	// "are.na annual", "Codex: The Journal…" → "codex". Titles with no number,
	// colon or comma stay their own series (two copies of a book still match).
	const series = (b) => sortKey(b.title).split(/[\d:,]/)[0].trim() || b.id;
	const seriesTint = new Map();
	const pick = (b) => {
		const key = series(b);
		if (seriesTint.has(key)) return { tint: seriesTint.get(key), fixed: true };
		const hue = hash(b.publishers[0] ?? b.id) % HUES.length;
		const step = 1 + (hash(key) % 3);
		return { tint: `${HUES[hue]}-${step}`, fixed: false };
	};
	const hueOf = (t) => t.replace(/-\d$/, '');
	// Typefaces work the same way: a series is set in one face, a publisher
	// keeps a house face, and neighbours differ. Seeded apart from the colour,
	// so a publisher's hue and face don't always arrive as the same pair.
	const seriesFace = new Map();
	const faceFor = (b) =>
		seriesFace.get(series(b)) ?? FACES[hash(`${b.publishers[0] ?? series(b)}·face`) % FACES.length];
	for (const row of rows) {
		let prev = null;
		for (const b of row) {
			let { tint, fixed } = pick(b);
			if (!fixed && prev && hueOf(prev.tint) === hueOf(tint) && series(prev) !== series(b)) {
				const i = HUES.indexOf(hueOf(tint));
				tint = `${HUES[(i + 4) % HUES.length]}-${tint.slice(-1)}`;
			}
			b.tint = tint;
			seriesTint.set(series(b), tint);

			let face = faceFor(b);
			if (!seriesFace.has(series(b)) && prev && prev.face === face && series(prev) !== series(b)) {
				face = FACES[(FACES.indexOf(face) + 5) % FACES.length];
			}
			b.face = face;
			seriesFace.set(series(b), face);
			prev = b;
		}
	}
}

// The spine faces: picks from the roster (RULES.md "Typography: the roster"),
// all OFL. Styled in src/routes/layout.css, credited in the site footer.
const FACES = [
	'work-sans', 'libre-franklin', 'gentium', 'eb-garamond', 'crimson-pro', 'newsreader',
	'plex-mono', 'league-gothic', 'young-serif', 'space-mono', 'bricolage', 'fraunces', 'basteleur'
];

// "Design of Everyday Things, The" → "The Design of Everyday Things"; drops stray HTML.
function cleanTitle(t) {
	t = (t ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
	const m = t.match(/^(.*),\s*(the|a|an)$/i);
	return m ? `${m[2][0].toUpperCase()}${m[2].slice(1).toLowerCase()} ${m[1]}` : t;
}
const sortKey = (t) => t.replace(/^(the|a|an)\s+/i, '').toLowerCase();

// Notion's import split names with commas in them across two entries:
// '"Vincent J. Scully' + 'Jr."', '"Dover Publications' + 'Inc."'. Glue them back.
function joinNames(list) {
	const outList = [];
	for (let i = 0; i < list.length; i++) {
		let n = list[i];
		if (n.startsWith('"') && i + 1 < list.length) n = `${n}, ${list[++i]}`;
		else if (n.endsWith('"') && outList.length) {
			// the tail of a split name whose head lost its quote ("Penguin Books" + 'Ltd."')
			outList[outList.length - 1] += `, ${n.replaceAll('"', '').trim()}`;
			continue;
		}
		n = n.replaceAll('"', '').trim();
		if (n && !/^\d+$/.test(n) && !outList.includes(n)) outList.push(n);
	}
	return outList;
}

// ISBNs were stored as numbers, so leading zeros and a trailing X are gone,
// and a few are typos. Keep only ones whose check digit works out.
function normalizeIsbn(s) {
	const d = (s ?? '').replace(/\D/g, '');
	if (!d) return null;
	const tries = [];
	if (d.length === 13 && d.startsWith('977')) return null; // a magazine's ISSN barcode, not an ISBN
	if (d.length === 13) tries.push(d);
	if (d.length === 12) tries.push('9' + d);
	if (d.length <= 10) {
		tries.push(d.padStart(10, '0'));
		if (d.length <= 9) tries.push(d.padStart(9, '0') + 'X');
	}
	for (const t of tries) {
		if (t.length === 13 && valid13(t)) return { isbn13: t, isbn10: t.startsWith('978') ? to10(t) : null };
		if (t.length === 10 && valid10(t)) return { isbn10: t, isbn13: to13(t) };
	}
	return null;
}
function valid10(s) {
	let sum = 0;
	for (let i = 0; i < 10; i++) sum += (s[i] === 'X' ? 10 : Number(s[i])) * (10 - i);
	return sum % 11 === 0;
}
function valid13(s) {
	let sum = 0;
	for (let i = 0; i < 13; i++) sum += Number(s[i]) * (i % 2 ? 3 : 1);
	return sum % 10 === 0;
}
function to13(isbn10) {
	const core = '978' + isbn10.slice(0, 9);
	let sum = 0;
	for (let i = 0; i < 12; i++) sum += Number(core[i]) * (i % 2 ? 3 : 1);
	return core + ((10 - (sum % 10)) % 10);
}
function to10(isbn13) {
	const core = isbn13.slice(3, 12);
	let sum = 0;
	for (let i = 0; i < 9; i++) sum += Number(core[i]) * (10 - i);
	const c = (11 - (sum % 11)) % 11;
	return core + (c === 10 ? 'X' : c);
}

function slugify(t) {
	return t.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
		.replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60).replace(/-$/, '');
}
function uniqueSlug(s, taken) {
	let slug = s || 'book', n = 2;
	while (taken.has(slug)) slug = `${s}-${n++}`;
	taken.add(slug);
	return slug;
}
function hash(s) {
	let h = 2166136261;
	for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
	return h >>> 0;
}
const round = (n) => Math.round(n * 100) / 100;

await main();

function loadEnv(file) {
	if (!fs.existsSync(file)) return;
	for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
		const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
		if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
	}
}
