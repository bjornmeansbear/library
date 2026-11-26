import data from './data/library.json';

export type Book = {
	id: string;
	slug: string;
	title: string;
	format: 'book' | 'film' | 'music' | 'journal' | 'zine';
	subtitle: string | null;
	authors: string[];
	publishers: string[];
	tags: string[];
	year: string | null;
	isbn10: string | null;
	isbn13: string | null;
	/** Another edition's ISBN for the Bookshop.org link, when yours isn't sold. */
	bookshopIsbn?: string | null;
	where: string | null;
	notes: string | null;
	pages: number | null;
	height: number;
	thickness: number;
	measured: boolean;
	sized: 'measured' | 'open-library' | 'library-of-congress' | 'pages' | 'guessed';
	tint: string;
	face: string;
	shelf: string | null;
	position: number | null;
};

export type Shelf = { id: string; name: string; room: string | null; books: string[] };

export const books = data.books as Book[];
export const bySlug = new Map(books.map((b) => [b.slug, b]));
export const shelves = (data.shelves as Shelf[]).map((s) => ({
	...s,
	books: s.books.map((slug) => bySlug.get(slug)!)
}));
export const generated = data.generated;

// Set this to your Bookshop.org affiliate ID to earn on links; empty means
// plain links and no affiliate disclosure.
export const BOOKSHOP_AFFILIATE_ID = '129137';

// A direct ISBN link 404s whenever Bookshop.org doesn't stock that exact
// edition (out of print, museum catalogues, foreign editions: much of this
// library). So by default it's a search for the title and author, which
// finds whatever edition is in print. A "Bookshop ISBN" set in Notion means
// that edition is known to be sold: link straight to it.
export function bookshopUrl(book: Pick<Book, 'title' | 'authors' | 'bookshopIsbn'>) {
	const aff = BOOKSHOP_AFFILIATE_ID;
	if (book.bookshopIsbn) {
		return aff ? `https://bookshop.org/a/${aff}/${book.bookshopIsbn}` : `https://bookshop.org/book/${book.bookshopIsbn}`;
	}
	const surname = book.authors[0]?.split(/\s+/).at(-1) ?? '';
	const keywords = `${book.title.split(/[:(]/)[0].trim()} ${surname}`.trim();
	return `https://bookshop.org/search?keywords=${encodeURIComponent(keywords)}${aff ? `&affiliate=${aff}` : ''}`;
}

export function ordinal(n: number) {
	const s = ['th', 'st', 'nd', 'rd'];
	const v = n % 100;
	return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
