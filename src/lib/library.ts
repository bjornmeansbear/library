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
	/** Checked by hand: true sold, false not sold, null not checked yet. */
	onBookshop?: boolean | null;
	/** More than one copy of this edition; null means one. */
	copies?: number | null;
	where: string | null;
	notes: string | null;
	/** Its page on bjornpaedia.wjerk.shop, when the wiki has one. */
	bjornpaedia?: string | null;
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
export type Tag = { name: string; count: number; intro: string | null };

export const books = data.books as Book[];
export const bySlug = new Map(books.map((b) => [b.slug, b]));
export const shelves = (data.shelves as Shelf[]).map((s) => ({
	...s,
	books: s.books.map((slug) => bySlug.get(slug)!)
}));
export const generated = data.generated;
export const tags = (data.tags ?? []) as Tag[];

// Set this to your Bookshop.org affiliate ID to earn on links; empty means
// plain links and no affiliate disclosure.
export const BOOKSHOP_AFFILIATE_ID = '129137';

// A direct ISBN link 404s whenever Bookshop.org doesn't stock that exact
// edition (out of print, museum catalogs, foreign editions: much of this
// library), and Bookshop.org has no public API to check. So stock is checked
// by hand in Notion ("On Bookshop", the 🛒 view):
//   Bookshop ISBN set   → straight to that edition
//   On Bookshop = Yes   → straight to the ISBN-13
//   On Bookshop = No    → no link
//   not checked yet     → a search for the ISBN-13: that edition or nothing
// Returns null when there's no link to show.
export function bookshopLink(
	book: Pick<Book, 'isbn13' | 'bookshopIsbn' | 'onBookshop'>
): { url: string; sure: boolean } | null {
	const aff = BOOKSHOP_AFFILIATE_ID;
	const direct = (isbn: string) =>
		aff ? `https://bookshop.org/a/${aff}/${isbn}` : `https://bookshop.org/book/${isbn}`;
	if (book.bookshopIsbn) return { url: direct(book.bookshopIsbn), sure: true };
	if (!book.isbn13 || book.onBookshop === false) return null;
	if (book.onBookshop) return { url: direct(book.isbn13), sure: true };
	return { url: `https://bookshop.org/search?keywords=${book.isbn13}${aff ? `&affiliate=${aff}` : ''}`, sure: false };
}

export function ordinal(n: number) {
	const s = ['th', 'st', 'nd', 'rd'];
	const v = n % 100;
	return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
