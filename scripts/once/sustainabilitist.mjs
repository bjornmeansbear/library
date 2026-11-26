// Bring the 95 books from the old thesustainabilitist.com/library (a Tumblr)
// into Notion.
//
//   node scripts/once/sustainabilitist.mjs            make the plan → SUSTAINABILITIST-PLAN.md
//   node scripts/once/sustainabilitist.mjs --apply    add the books the plan says to add
//
// The plan matches every Tumblr book against Notion (by ISBN, then by title).
// Books already there are left alone. The rest are listed with Open Library's
// details and a Where, "Not mine (recommended)" unless you change it in
// data/sustainabilitist-plan.json to "Personal Library (KB office)",
// "MISSING!" (owned, lost), any other Where option, or "skip".
import fs from 'node:fs';
import path from 'node:path';
import { DS, api, queryAll, text, titleOf, rich, nameIndex, findOrCreate, nameKey } from '../lib/notion.mjs';
import { edition, isbn13 } from '../lib/openlibrary.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const planJson = path.join(root, 'data/sustainabilitist-plan.json');
const planMd = path.join(root, 'SUSTAINABILITIST-PLAN.md');
const TUMBLR = 'https://api.tumblr.com/v2/blog/sustainabilitist.tumblr.com/posts?api_key=OmMwFOoJB741CZxXe57kU8moYu0iMzKMtlDKZdE3djCKqJVWgY';

const decode = (s) => s
	.replace(/<[^>]+>/g, '')
	.replace(/&(rsquo|lsquo);/g, '’').replace(/&(rdquo|ldquo);/g, '"').replace(/&amp;/g, '&')
	.replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
	.replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
// Titles without a leading article or anything after a colon/bracket.
const key = (t) => nameKey(t.replace(/^(the|a|an)\s+/i, '').split(/[:(]/)[0]);

// Amazon's titles (the Tumblr's) are properly capitalised but carry series
// and edition notes; Open Library's are clean but often lowercase. Take the
// words from the Tumblr, minus the notes.
const SMALL = /^(a|an|and|as|at|but|by|for|from|in|into|nor|of|on|or|the|to|with|vs?\.?)$/i;
const titleCase = (s) => s.split(' ').map((w, i, a) =>
	i > 0 && !/[:—]$/.test(a[i - 1]) && SMALL.test(w) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const fixCase = (s) => (s && s === s.toLowerCase() ? titleCase(s) : s);
function splitTitle(t) {
	const clean = t.replace(/\s*\([^)]*\)/g, '')
		.replace(/,?\s*(Revised( and Updated)?|Updated|Widescreen|\d+\w* Anniversary) Edition\b/gi, '')
		.replace(/^(.*), (The|A|An)\b/, '$2 $1').trim();
	const [title, ...rest] = clean.split(/\s*:\s+/);
	return { title: fixCase(title), subtitle: rest.length ? fixCase(rest.join(': ')) : null };
}
// "Jones, Richard" → "Richard Jones"; "Kira Gould and Lance Hosey" → two.
const splitAuthors = (s) => s.split(/\s*(?:;|&| and )\s*/).filter(Boolean)
	.map((a) => a.replace(/^([^,]+),\s*([^,]+)$/, '$2 $1').trim());
// Albums and films the Tumblr also listed.
const NOT_BOOKS = { 'Discreet Music': 'Music', 'Ambient 1/Music For Airports': 'Music', 'Thank You for Smoking': 'Film' };

if (process.argv.includes('--apply')) await applyPlan();
else await makePlan();

async function tumblrBooks() {
	const out = [];
	for (let offset = 0; ; offset += 20) {
		const r = (await (await fetch(`${TUMBLR}&offset=${offset}`)).json()).response;
		for (const p of r.posts) {
			const cap = p.caption ?? p.body ?? '';
			const title = decode(cap.match(/<h1>(.*?)<\/h1>/s)?.[1] ?? p.summary ?? '');
			const author = decode(cap.match(/<h2>(.*?)<\/h2>/s)?.[1] ?? '');
			const asin = (p.link_url ?? '').match(/\/(?:ASIN|dp|product)\/([0-9X]{10})/i)?.[1];
			if (title) out.push({ title, author, isbn: asin ? isbn13(asin) : null, post: p.post_url });
		}
		if (offset + 20 >= r.total_posts) break;
	}
	return out;
}

async function makePlan() {
	const posts = await tumblrBooks();
	const books = await queryAll(DS.books);
	const byIsbn = new Map();
	for (const p of books) for (const raw of [text(p.properties['ISBN-13']), p.properties['ISBN']?.number]) {
		const i = raw != null && raw !== '' ? isbn13(String(raw)) : null;
		if (i) byIsbn.set(i, p);
	}
	const people = await nameIndex('people');
	const publishers = await nameIndex('publishers');
	// Match "Victor J. Papanek" to "Victor Papanek".
	const noInitials = (n) => nameKey(n).replace(/\b[a-z]\b/g, ' ').replace(/\s+/g, ' ').trim();
	const loose = new Map([...people.values()].map((e) => [noInitials(e.name), e]));
	const person = async (n) => {
		const hit = await findOrCreate('people', n, people, { create: false });
		const alt = hit.created && loose.get(noInitials(n));
		return alt ? { id: alt.id, name: alt.name, created: false } : hit;
	};

	const have = [], add = [];
	const seen = new Set();
	for (const t of posts) {
		const k = key(t.title);
		if (seen.has(t.isbn ?? k)) continue; // the Tumblr posted a few twice
		seen.add(t.isbn ?? k);
		const twin = (t.isbn && byIsbn.get(t.isbn)) || books.find((p) => {
			const a = key(titleOf(p));
			return a.length > 3 && (a === k || (k.startsWith(a) && a.length > 12) || (a.startsWith(k) && k.length > 12));
		});
		if (twin) { have.push({ ...t, notion: titleOf(twin), url: twin.url }); continue; }

		const ol = t.isbn ? await edition(t.isbn) : null;
		const authorNames = (ol?.authors?.length ? ol.authors : [t.author]).flatMap(splitAuthors);
		const authors = [];
		for (const a of authorNames) authors.push(await person(a));
		const pubName = ol?.publishers?.[0];
		const publisher = pubName ? await findOrCreate('publishers', pubName, publishers, { create: false }) : null;
		const name = splitTitle(t.title);
		const kind = NOT_BOOKS[name.title];
		add.push({
			n: add.length + 1,
			where: 'Not mine (recommended)',
			format: kind ?? 'Book',
			note: kind === 'Music' ? 'An album (drawn as a CD case).' : kind === 'Film' ? 'A film (drawn as a DVD case).' : null,
			title: name.title,
			subtitle: name.subtitle ?? fixCase(ol?.subtitle ?? null),
			authors: authors.map((a) => ({ name: a.name, new: !!a.created })),
			publisher: publisher ? { name: publisher.name, new: !!publisher.created } : null,
			year: ol?.year ?? null,
			lcc: ol?.lcc ?? null,
			isbn: t.isbn,
			openLibrary: ol ? `https://openlibrary.org${ol.key}` : null,
			tumblrTitle: t.title,
			post: t.post
		});
	}

	fs.writeFileSync(planJson, JSON.stringify(add, null, '\t') + '\n');
	const line = (r) => `| ${r.n} | ${r.where === 'skip' ? '~~' : ''}**${r.title}**${r.where === 'skip' ? '~~' : ''}${r.subtitle ? `: ${r.subtitle}` : ''}<br>${r.authors.map((a) => a.name + (a.new ? ' (new)' : '')).join(', ') || '—'} · ${r.publisher ? r.publisher.name + (r.publisher.new ? ' (new)' : '') : '**no publisher**'}${r.year ? ` · ${r.year}` : ''}${r.note ? `<br>*${r.note}*` : ''} | ${r.openLibrary ? `[OL](${r.openLibrary})` : 'not on OL'} |`;
	fs.writeFileSync(planMd, `# Sustainabilitist books: import plan

Generated ${new Date().toISOString().slice(0, 10)}. Nothing has been written to Notion yet.

The old library had **${posts.length} posts**, **${seen.size} different books**. **${have.length}** are already in Notion and are left alone. **${add.length}** aren't, and are listed below to add.

## What I need from you

Every book below will be added as **Not mine (recommended)** unless you say otherwise. Just tell Claude the numbers, e.g.:

> own 3, 12, 40 · lost 7, 19 · skip 22

- **own**: it's on your shelves → Personal Library (KB office), or name another Where
- **lost**: you had it, it's gone → MISSING!
- **skip**: don't add it at all

Then: "apply the Sustainabilitist plan".

${add.filter((r) => !r.publisher).length ? `${add.filter((r) => !r.publisher).length} have no publisher on Open Library (marked **no publisher**); they'll be added without one and show up in 🔎 Needs info.\n\n` : ''}## To add (${add.length})

| # | Book | |
|---|---|---|
${add.map(line).join('\n')}

## Already in Notion (${have.length})

${have.map((h) => `- ${h.title} → [${h.notion}](${h.url})`).join('\n')}
`);
	console.log(`${posts.length} posts, ${seen.size} books: ${have.length} already in Notion, ${add.length} to add → SUSTAINABILITIST-PLAN.md`);
}

async function applyPlan() {
	const plan = JSON.parse(fs.readFileSync(planJson, 'utf8'));
	const books = await queryAll(DS.books);
	const titles = new Set(books.map((p) => key(titleOf(p))));
	const people = await nameIndex('people');
	const publishers = await nameIndex('publishers');
	let n = 0;
	for (const r of plan) {
		if (r.where === 'skip') continue;
		if (titles.has(key(r.title))) { console.log(`= ${r.title}: already there, skipped`); continue; }
		const authorIds = [];
		for (const a of r.authors) authorIds.push((await findOrCreate('people', a.name, people, { create: true })).id);
		const props = {
			Name: { title: [{ text: { content: r.title } }] },
			Author: { relation: authorIds.map((id) => ({ id })) },
			Format: { select: { name: r.format ?? 'Book' } },
			Where: { select: { name: r.where } },
			'Date Added': { date: { start: new Date().toISOString().slice(0, 10) } }
		};
		if (r.publisher) props.Publisher = { relation: [{ id: (await findOrCreate('publishers', r.publisher.name, publishers, { create: true })).id }] };
		if (r.isbn && r.format === 'Book') props['ISBN-13'] = rich(r.isbn);
		if (r.subtitle) props.Subtitle = rich(r.subtitle);
		if (r.year) props.Year = rich(r.year);
		if (r.lcc) props['LOC Call Number'] = rich(r.lcc);
		await api('POST', 'pages', { parent: { type: 'data_source_id', data_source_id: DS.books }, properties: props });
		titles.add(key(r.title));
		n++;
		console.log(`+ ${r.title} (${r.where})`);
	}
	console.log(`\nAdded ${n} books. Run \`npm run sync\` and push, or wait for the nightly sync.`);
}
