// Add books to Notion by ISBN.
//
//   npm run add -- 9780262019842
//   npm run add -- 9780262019842 0195019199 --where "GD Office"
//   npm run add -- 9781234567897 --title "Some Zine" --publisher "Self-published"
//   npm run add -- 9780262019842 --dry-run      show what it would create
//
// Takes ISBN-10s or -13s, typed or scanned (a barcode scanner types like a
// keyboard, so a scanning session is one long command). For each one it
// checks the book isn't already there, looks it up on Open Library, and
// creates the page: title, subtitle, author, publisher, year, ISBN-13, LOC
// call number, Format, Date Added, and pages and size from Open Library or
// the Library of Congress when they know them. Existing author and publisher pages are
// reused when the names match; new ones are made otherwise.
//
// A book has to have a publisher (from Open Library or --publisher), so the
// library doesn't grow blanks again.
//
// Options apply to every ISBN in the command:
//   --where "GD Office"      the Where field (any existing option)
//   --format Film            Book (default), Film, Journal, Zine
//   --title "…"              when Open Library doesn't know the book
//   --publisher "…"          when Open Library has no publisher
//   --force                  add even if a book with the same title is there
//   --dry-run                change nothing
import { DS, api, queryAll, text, titleOf, rich, nameIndex, findOrCreate, nameKey } from './lib/notion.mjs';
import { edition, isbn13 } from './lib/openlibrary.mjs';
import { locRecord, sizeProps } from './lib/sizes.mjs';

const args = process.argv.slice(2);
const opt = (name) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : undefined;
};
const dryRun = args.includes('--dry-run');
const flagValues = new Set(['where', 'format', 'title', 'publisher'].map(opt).filter(Boolean));
const inputs = args.filter((a) => !a.startsWith('--') && !flagValues.has(a));

if (!inputs.length) {
	console.log('Usage: npm run add -- <isbn> [<isbn> …] [--where "GD Office"] [--format Book] [--dry-run]');
	process.exit(1);
}

const books = await queryAll(DS.books);
const have = new Map();
for (const p of books) {
	for (const raw of [text(p.properties['ISBN-13']), p.properties['ISBN']?.number]) {
		const i = raw != null && raw !== '' ? isbn13(String(raw)) : null;
		if (i) have.set(i, p);
	}
}
const people = await nameIndex('people');
const publishers = await nameIndex('publishers');

let added = 0;
for (const input of inputs) {
	const isbn = isbn13(input);
	if (!isbn) {
		console.log(`✗ ${input}: not a valid ISBN (the check digit doesn't work out). Re-check the number.`);
		continue;
	}
	if (have.has(isbn)) {
		const p = have.get(isbn);
		console.log(`= ${isbn}: already in the library as “${titleOf(p)}” ${p.url}`);
		continue;
	}

	const ol = await edition(isbn);
	const title = ol?.title ?? opt('title');
	if (!title) {
		console.log(`✗ ${isbn}: Open Library doesn't know this book. Add it with --title "…" --publisher "…".`);
		continue;
	}
	// Same book already here under a missing or mistyped ISBN? Match titles,
	// ignoring a leading "The"/"A" and anything after a colon.
	const key = (t) => nameKey(t.replace(/^(the|a|an)\s+/i, '').split(/[:(]/)[0]);
	const twin = !args.includes('--force') && books.find((p) => {
		const a = key(titleOf(p)), b = key(title);
		return a.length > 3 && (a === b || (b.startsWith(a) && a.length > 12) || (a.startsWith(b) && b.length > 12));
	});
	if (twin) {
		console.log(`? ${isbn} “${title}”: looks like it's already here as “${titleOf(twin)}” (whose ISBN doesn't match).\n  Put ${isbn} in that page's ISBN-13 instead: ${twin.url}\n  Or, if it really is a different book, run again with --force.`);
		continue;
	}

	const publisherName = ol?.publishers?.[0] ?? opt('publisher');
	if (!publisherName) {
		console.log(`✗ ${isbn} “${title}”: no publisher on Open Library. Run again with --publisher "…".`);
		continue;
	}

	const create = !dryRun;
	const authors = [];
	for (const a of ol?.authors ?? []) authors.push(await findOrCreate('people', a, people, { create }));
	const publisher = await findOrCreate('publishers', publisherName, publishers, { create });

	const props = {
		Name: { title: [{ text: { content: title } }] },
		'ISBN-13': rich(isbn),
		Publisher: { relation: publisher.id ? [{ id: publisher.id }] : [] },
		Author: { relation: authors.filter((a) => a.id).map((a) => ({ id: a.id })) },
		Format: { select: { name: opt('format') ?? 'Book' } },
		'Date Added': { date: { start: new Date().toISOString().slice(0, 10) } }
	};
	if (ol?.subtitle) props['Subtitle'] = rich(ol.subtitle);
	if (ol?.year) props['Year'] = rich(ol.year);
	if (ol?.lcc) props['LOC Call Number'] = rich(ol.lcc);
	if (opt('where')) props['Where'] = { select: { name: opt('where') } };
	const format = opt('format') ?? 'Book';
	if (format !== 'Film' && format !== 'Music') {
		Object.assign(props, sizeProps({ ol, loc: await locRecord(isbn), empty: { height: true, width: true, thickness: true, pages: true } }));
	}

	const who = authors.map((a) => a.name + (a.created ? ' (new)' : '')).join(', ') || 'no author listed';
	const size = props['Height (mm)'] ? ` · ${props['Height (mm)'].number} mm tall (${props['Size from'].select.name})` : '';
	const line = `“${title}”${ol?.subtitle ? `: ${ol.subtitle}` : ''} · ${who} · ${publisher.name}${publisher.created ? ' (new)' : ''}${ol?.year ? ` · ${ol.year}` : ''}${size}`;
	if (dryRun) {
		console.log(`○ ${isbn} would add ${line}`);
		continue;
	}
	const page = await api('POST', 'pages', { parent: { type: 'data_source_id', data_source_id: DS.books }, properties: props });
	have.set(isbn, page);
	added++;
	console.log(`+ ${isbn} added ${line}\n  ${page.url}`);
}

if (added) console.log(`\n${added} added. They'll show on the site after the next sync (nightly, or \`npm run sync\` and push).`);
