// The /scan page's server side: look a book up by ISBN and add it to the
// Notion library, the same way `npm run add` does (scripts/add.mjs), from
// the Worker. The Notion token and the page's passphrase are Worker
// secrets (NOTION_TOKEN, SCAN_KEY), never in the code or the browser.
import { edition, isbn13 } from '../../../scripts/lib/openlibrary.mjs';
import { locRecord, sizeProps } from '../../../scripts/lib/sizes.mjs';
import { nameKey, shortPublisher } from '../../../scripts/lib/names.mjs';
import { DS } from '../../../scripts/lib/ids.mjs';


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
	const n = notion(token);
	const [books, schema, known] = await Promise.all([
		n.queryAll(DS.books),
		n.api('GET', `data_sources/${DS.books}`),
		whatIsKnown(isbn)
	]);
	const where: string[] = schema.properties?.Where?.select?.options?.map((o: any) => o.name) ?? [];
	const formats: string[] = schema.properties?.Format?.select?.options?.map((o: any) => o.name) ?? [];
	const same = withIsbn(books, isbn);
	if (same) return { isbn, where, formats, have: { title: titleOf(same), url: same.url } };
	const title = known.book.title;
	const twin = title
		? books.find((p) => {
				const a = titleKey(titleOf(p)), b = titleKey(title);
				return a.length > 3 && (a === b || (b.startsWith(a) && a.length > 12) || (a.startsWith(b) && b.length > 12));
			})
		: null;
	return { isbn, where, formats, book: known.book, twin: twin ? { title: titleOf(twin), url: twin.url } : null };
}

// Add it, whatever is or isn't known. Authors and publisher are matched to
// existing pages by name or made new; a missing publisher stays blank (for
// `npm run fill` later) and a book nobody knows goes in as "ISBN …".
export async function add(token: string, o: { isbn: string; where?: string; format?: string }) {
	const isbn = isbn13(o.isbn);
	if (!isbn) return { error: 'Not a valid ISBN.' };
	const n = notion(token);
	const [books, people, publishers, known] = await Promise.all([
		n.queryAll(DS.books),
		n.queryAll(DS.people),
		n.queryAll(DS.publishers),
		whatIsKnown(isbn, { sizes: true })
	]);
	const same = withIsbn(books, isbn);
	if (same) return { error: `Already in the library as “${titleOf(same)}”.`, url: same.url };
	const b = known.book;
	const title = b.title ?? `ISBN ${isbn}`;

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

	const format = o.format || 'Book';
	const props: Record<string, any> = {
		Name: { title: [{ text: { content: title } }] },
		'ISBN-13': rich(isbn),
		Publisher: { relation: publisher ? [{ id: publisher.id }] : [] },
		Author: { relation: authors.map((a) => ({ id: a.id })) },
		Format: { select: { name: format } },
		'Date Added': { date: { start: new Date().toISOString().slice(0, 10) } }
	};
	if (b.subtitle) props['Subtitle'] = rich(b.subtitle);
	if (b.year) props['Year'] = rich(b.year);
	if (known.ol?.lcc) props['LOC Call Number'] = rich(known.ol.lcc);
	if (o.where) props['Where'] = { select: { name: o.where } };
	if (format !== 'Film' && format !== 'Music') {
		Object.assign(props, sizeProps({ ol: known.ol, loc: known.loc, empty: { height: true, width: true, thickness: true, pages: true } }));
	}
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
