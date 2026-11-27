// The /scan page's server side: look a book up by ISBN and add it to the
// Notion library, the same way `npm run add` does (scripts/add.mjs), from
// the Worker. The Notion token and the page's passphrase are Worker
// secrets (NOTION_TOKEN, SCAN_KEY), never in the code or the browser.
import { edition, isbn13 } from '../../../scripts/lib/openlibrary.mjs';
import { locRecord, sizeProps } from '../../../scripts/lib/sizes.mjs';
import { nameKey, shortPublisher } from '../../../scripts/lib/names.mjs';

const DS = {
	books: 'f4d45ea0-fcaf-44cb-a488-5a3e6ba3537f',
	people: 'dcabd07d-b2e1-4af3-a0cc-51ed47cc1678',
	publishers: '9027a079-5e5d-44c5-a5aa-a5b3abfd441a'
} as const;

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
// A leading "The"/"A" and anything after a colon don't count when matching titles.
const titleKey = (t: string) => nameKey(t.replace(/^(the|a|an)\s+/i, '').split(/[:(]/)[0]);

// What the page shows before adding: the book Open Library knows for this
// ISBN, whether it's already in the library (by ISBN, or by a title that
// looks like the same book), and the Where options to choose from.
export async function lookup(token: string, input: string) {
	const isbn = isbn13(input);
	if (!isbn) return { error: 'That isn’t a valid ISBN: the check digit doesn’t work out. Check the number.' };
	const n = notion(token);
	const [books, schema, ol] = await Promise.all([
		n.queryAll(DS.books),
		n.api('GET', `data_sources/${DS.books}`),
		edition(isbn)
	]);
	const where: string[] = schema.properties?.Where?.select?.options?.map((o: any) => o.name) ?? [];
	const formats: string[] = schema.properties?.Format?.select?.options?.map((o: any) => o.name) ?? [];
	const same = books.find((p) =>
		[plain(p.properties['ISBN-13']), p.properties['ISBN']?.number].some((raw) => raw != null && raw !== '' && isbn13(String(raw)) === isbn)
	);
	if (same) return { isbn, where, formats, have: { title: titleOf(same), url: same.url } };
	if (!ol?.title) return { isbn, where, formats, unknown: true };
	const b = titleKey(ol.title);
	const twin = books.find((p) => {
		const a = titleKey(titleOf(p));
		return a.length > 3 && (a === b || (b.startsWith(a) && a.length > 12) || (a.startsWith(b) && b.length > 12));
	});
	return {
		isbn,
		where,
		formats,
		book: {
			title: ol.title,
			subtitle: ol.subtitle,
			authors: ol.authors,
			publisher: ol.publishers?.[0] ?? null,
			year: ol.year,
			pages: ol.pages
		},
		twin: twin ? { title: titleOf(twin), url: twin.url } : null
	};
}

// Add it: authors and publisher matched to existing pages by name or made
// new, sizes from Open Library or the Library of Congress. A title and a
// publisher can be given when Open Library doesn't know them.
export async function add(
	token: string,
	o: { isbn: string; where?: string; format?: string; title?: string; publisher?: string; force?: boolean }
) {
	const isbn = isbn13(o.isbn);
	if (!isbn) return { error: 'Not a valid ISBN.' };
	const n = notion(token);
	const [books, people, publishers, ol] = await Promise.all([
		n.queryAll(DS.books),
		n.queryAll(DS.people),
		n.queryAll(DS.publishers),
		edition(isbn)
	]);
	const same = books.find((p) => isbn13(String(plain(p.properties['ISBN-13']) || p.properties['ISBN']?.number || '')) === isbn);
	if (same && !o.force) return { error: `Already in the library as “${titleOf(same)}”.`, url: same.url };
	const title = ol?.title ?? o.title?.trim();
	if (!title) return { error: 'Open Library doesn’t know this book: give it a title.' };
	const publisherName = ol?.publishers?.[0] ?? o.publisher?.trim();
	if (!publisherName) return { error: 'No publisher on Open Library: give it one.' };

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
	for (const a of ol?.authors ?? []) authors.push(await findOrCreate('people', a, people));
	const publisher = await findOrCreate('publishers', publisherName, publishers);

	const format = o.format || 'Book';
	const props: Record<string, any> = {
		Name: { title: [{ text: { content: title } }] },
		'ISBN-13': rich(isbn),
		Publisher: { relation: [{ id: publisher.id }] },
		Author: { relation: authors.map((a) => ({ id: a.id })) },
		Format: { select: { name: format } },
		'Date Added': { date: { start: new Date().toISOString().slice(0, 10) } }
	};
	if (ol?.subtitle) props['Subtitle'] = rich(ol.subtitle);
	if (ol?.year) props['Year'] = rich(ol.year);
	if (ol?.lcc) props['LOC Call Number'] = rich(ol.lcc);
	if (o.where) props['Where'] = { select: { name: o.where } };
	if (format !== 'Film' && format !== 'Music') {
		Object.assign(
			props,
			sizeProps({ ol, loc: await locRecord(isbn), empty: { height: true, width: true, thickness: true, pages: true } })
		);
	}
	const page = await n.api('POST', 'pages', {
		parent: { type: 'data_source_id', data_source_id: DS.books },
		properties: props
	});
	return {
		added: { title, url: page.url, authors: authors.map((a) => a.name + (a.created ? ' (new)' : '')), publisher: publisher.name + (publisher.created ? ' (new)' : '') }
	};
}
