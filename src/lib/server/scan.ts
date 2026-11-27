// The /scan page's server side: look a book up by ISBN (or, for a book
// printed before ISBNs, search by title) and add it to the Notion library,
// the same way `npm run add` does (scripts/add.mjs), from the Worker. The Notion token and the page's passphrase are Worker
// secrets (NOTION_TOKEN, SCAN_KEY), never in the code or the browser.
import { edition, isbn13, olSearch } from '../../../scripts/lib/openlibrary.mjs';
import { locRecord, locSearch, sizeProps } from '../../../scripts/lib/sizes.mjs';
import { nameKey, shortPublisher } from '../../../scripts/lib/names.mjs';
import { DS, roomOf } from '../../../scripts/lib/ids.mjs';

type Page = { id: string; url: string; properties: Record<string, any> };

export function notion(token: string) {
	async function api(method: string, url: string, body?: unknown): Promise<any> {
		for (let attempt = 0; ; attempt++) {
			const res = await fetch(`https://api.notion.com/v1/${url}`, {
				method,
				headers: {
					Authorization: `Bearer ${token}`,
					'Notion-Version': '2025-09-03',
					'Content-Type': 'application/json'
				},
				body: body ? JSON.stringify(body) : undefined
			});
			if ((res.status === 429 || res.status >= 500) && attempt < 4) {
				await new Promise((r) => setTimeout(r, Number(res.headers.get('retry-after') ?? 1) * 1000));
				continue;
			}
			if (!res.ok) throw new Error(`Notion ${res.status}: ${(await res.text()).slice(0, 200)}`);
			return res.json();
		}
	}
	async function queryAll(ds: string): Promise<Page[]> {
		const out: Page[] = [];
		let cursor: string | undefined;
		do {
			const r = await api('POST', `data_sources/${ds}/query`, { page_size: 100, start_cursor: cursor });
			out.push(...r.results);
			cursor = r.has_more ? r.next_cursor : undefined;
		} while (cursor);
		return out;
	}
	return { api, queryAll };
}

const plain = (p: any) => (p?.title ?? p?.rich_text ?? []).map((t: any) => t.plain_text).join('').trim();
const titleOf = (page: Page) => plain(Object.values(page.properties).find((p: any) => p.type === 'title'));
const rich = (s: string) => ({ rich_text: [{ text: { content: s } }] });
// The page that already has this ISBN, in ISBN-13 or the old ISBN number field.
const withIsbn = (books: Page[], isbn: string) =>
	books.find((p) =>
		[plain(p.properties['ISBN-13']), p.properties['ISBN']?.number].some(
			(raw) => raw != null && raw !== '' && isbn13(String(raw)) === isbn
		)
	);
// A leading "The"/"A" and anything after a colon don't count when matching titles.
const titleKey = (t: string) => nameKey(t.replace(/^(the|a|an)\s+/i, '').split(/[:(]/)[0]);

// Everything Open Library knows about an ISBN, with the gaps filled from
// the Library of Congress. Any of it can be null: some books just aren't
// findable, and that's fine. Also returns both raw records, for sizes.
// The Library of Congress is slower, so it's only asked when there's a gap,
// or when the size is wanted (adding).
async function whatIsKnown(isbn: string, { sizes = false } = {}) {
	const ol = await edition(isbn);
	const gap = !ol?.title || !ol.publishers?.length || !ol.authors?.length;
	const loc = sizes || gap ? await locRecord(isbn) : null;
	return {
		ol,
		loc,
		book: {
			title: ol?.title ?? loc?.title ?? null,
			subtitle: ol?.subtitle ?? loc?.subtitle ?? null,
			authors: ol?.authors?.length ? ol.authors : loc?.author ? [loc.author] : [],
			publisher: ol?.publishers?.[0] ?? loc?.publisher ?? null,
			year: ol?.year ?? loc?.year ?? null,
			pages: ol?.pages ?? loc?.pages ?? null
		}
	};
}

// What the page shows before adding: what's known about the book, whether
// it's already in the library (by ISBN, or by a title that looks like the
// same book), and the Where options to choose from.
export async function lookup(token: string, input: string) {
	const isbn = isbn13(input);
	if (!isbn) return { error: 'That isn’t a valid ISBN: the check digit doesn’t work out. Check the number.' };
	const [ctx, known] = await Promise.all([context(notion(token)), whatIsKnown(isbn)]);
	const { where, formats, shelves } = ctx;
	const same = withIsbn(ctx.books, isbn);
	if (same) return { isbn, where, formats, shelves, have: { title: titleOf(same), url: same.url } };
	return { isbn, where, formats, shelves, book: known.book, twin: twinOf(ctx.books, known.book.title) };
}

export type Known = {
	title: string | null;
	subtitle: string | null;
	authors: string[];
	publisher: string | null;
	year: string | null;
	pages: number | null;
	heightCm?: number | null;
	widthCm?: number | null;
};

// The library's Where and Format options, its shelves (each with its room),
// and the titles already in it.
async function context(n: ReturnType<typeof notion>) {
	const [books, schema, shelfPages, roomPages] = await Promise.all([
		n.queryAll(DS.books),
		n.api('GET', `data_sources/${DS.books}`),
		n.queryAll(DS.shelves),
		n.queryAll(DS.rooms)
	]);
	const roomNames = new Map(roomPages.map((p) => [p.id, titleOf(p)]));
	const options = (name: string): string[] => schema.properties?.[name]?.select?.options?.map((o: any) => o.name) ?? [];
	const shelves = shelfPages
		.map((p) => ({ id: p.id, name: titleOf(p), room: roomOf(p, roomNames) as string }))
		.filter((s) => s.name)
		.sort((a, b) => a.room.localeCompare(b.room) || a.name.localeCompare(b.name, 'en', { numeric: true }));
	return { books, where: options('Where'), formats: options('Format'), shelves };
}

// The page already here under a title that looks like the same book.
function twinOf(books: Page[], title: string | null) {
	if (!title) return null;
	const b = titleKey(title);
	const p = books.find((p) => {
		const a = titleKey(titleOf(p));
		return a.length > 3 && (a === b || (b.startsWith(a) && a.length > 12) || (a.startsWith(b) && b.length > 12));
	});
	return p ? { title: titleOf(p), url: p.url } : null;
}

// For a book with no ISBN: editions the Library of Congress has (each with
// its own publisher, year and size), then works Open Library has, each
// marked if a book with the same title is already in the library.
export async function search(token: string, words: string) {
	words = words.trim();
	if (words.length < 3) return { error: 'Type a few words of the title, and the author if you know it.' };
	const n = notion(token);
	const [ctx, loc, ol] = await Promise.all([context(n), locSearch(words), olSearch(words)]);
	const seen = new Set<string>();
	const results = [
		...loc.map((b: any) => ({ ...b, authors: b.author ? [b.author] : [], source: 'Library of Congress' })),
		...ol.map((b: any) => ({ ...b, source: 'Open Library' }))
	].filter((b) => {
		const key = `${titleKey(b.title)}|${b.year}|${nameKey(b.publisher ?? '', true)}`;
		return !seen.has(key) && seen.add(key);
	});
	return {
		where: ctx.where,
		formats: ctx.formats,
		shelves: ctx.shelves,
		results: results.map((b) => ({ ...b, twin: twinOf(ctx.books, b.title) }))
	};
}

// Make the Notion page for a book: authors and publisher matched to
// existing pages by name or made new; a missing publisher stays blank (for
// `npm run fill` later); a book with no title goes in as "ISBN …".
async function createBook(
	n: ReturnType<typeof notion>,
	b: Known,
	o: { isbn?: string; where?: string; shelf?: string; format?: string; lcc?: string | null; sizes?: Record<string, any> }
) {
	const [people, publishers] = await Promise.all([n.queryAll(DS.people), n.queryAll(DS.publishers)]);
	async function findOrCreate(kind: 'people' | 'publishers', name: string, pages: Page[]) {
		const isPublisher = kind === 'publishers';
		const clean = isPublisher ? shortPublisher(name) : name.trim();
		const hit = pages.find((p) => nameKey(titleOf(p), isPublisher) === nameKey(clean, isPublisher));
		if (hit) return { id: hit.id, name: titleOf(hit), created: false };
		const page = await n.api('POST', 'pages', {
			parent: { type: 'data_source_id', data_source_id: DS[kind] },
			properties: { Name: { title: [{ text: { content: clean } }] } }
		});
		pages.push({ ...page, properties: { Name: { type: 'title', title: [{ plain_text: clean }] } } });
		return { id: page.id, name: clean, created: true };
	}
	const authors = [];
	for (const a of b.authors) authors.push(await findOrCreate('people', a, people));
	const publisher = b.publisher ? await findOrCreate('publishers', b.publisher, publishers) : null;
	const title = b.title ?? `ISBN ${o.isbn}`;
	const props: Record<string, any> = {
		Name: { title: [{ text: { content: title } }] },
		Publisher: { relation: publisher ? [{ id: publisher.id }] : [] },
		Author: { relation: authors.map((a) => ({ id: a.id })) },
		Format: { select: { name: o.format || 'Book' } },
		'Date Added': { date: { start: new Date().toISOString().slice(0, 10) } },
		...o.sizes
	};
	if (o.isbn) props['ISBN-13'] = rich(o.isbn);
	if (b.subtitle) props['Subtitle'] = rich(b.subtitle);
	if (b.year) props['Year'] = rich(b.year);
	if (o.lcc) props['LOC Call Number'] = rich(o.lcc);
	if (o.where) props['Where'] = { select: { name: o.where } };
	if (o.shelf) props['🗄️ Shelf'] = { relation: [{ id: o.shelf }] };
	const page = await n.api('POST', 'pages', {
		parent: { type: 'data_source_id', data_source_id: DS.books },
		properties: props
	});
	return {
		added: {
			title,
			url: page.url,
			authors: authors.map((a) => a.name + (a.created ? ' (new)' : '')),
			publisher: publisher ? publisher.name + (publisher.created ? ' (new)' : '') : null
		}
	};
}

// Add by ISBN, whatever is or isn't known about it.
export async function add(token: string, o: { isbn: string; where?: string; shelf?: string; format?: string }) {
	const isbn = isbn13(o.isbn);
	if (!isbn) return { error: 'Not a valid ISBN.' };
	const n = notion(token);
	const [books, known] = await Promise.all([n.queryAll(DS.books), whatIsKnown(isbn, { sizes: true })]);
	const same = withIsbn(books, isbn);
	if (same) return { error: `Already in the library as “${titleOf(same)}”.`, url: same.url };
	const physical = o.format !== 'Film' && o.format !== 'Music';
	const sizes = physical
		? sizeProps({ ol: known.ol, loc: known.loc, empty: { height: true, width: true, thickness: true, pages: true } })
		: {};
	return createBook(n, known.book, { ...o, isbn, lcc: known.ol?.lcc, sizes });
}

// Add an edition picked from a title search (no ISBN).
export async function addFound(token: string, o: { book: Known; where?: string; shelf?: string; format?: string }) {
	const b = o.book;
	if (!b?.title) return { error: 'Pick a book from the search first.' };
	const sizes: Record<string, any> = {};
	if (b.heightCm && b.heightCm >= 8 && b.heightCm <= 50) {
		sizes['Height (mm)'] = { number: Math.round(b.heightCm * 10) };
		if (b.widthCm) sizes['Width (mm)'] = { number: Math.round(b.widthCm * 10) };
		sizes['Size from'] = { select: { name: 'Library of Congress' } };
	}
	if (b.pages && b.pages < 5000) sizes['Pages'] = { number: b.pages };
	return createBook(notion(token), b, { where: o.where, shelf: o.shelf, format: o.format, sizes });
}
