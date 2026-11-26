import { error } from '@sveltejs/kit';
import { books, bySlug } from '#lib/library.ts';
import type { EntryGenerator, PageLoad } from './$types';

// A page per book, for shared links and for opening a book in a new tab.
// On the bookcase itself a click shows the same card in a popup instead.
export const entries: EntryGenerator = () => books.map((b) => ({ slug: b.slug }));

export const load: PageLoad = ({ params }) => {
	const book = bySlug.get(params.slug);
	if (!book) error(404, 'No book with that name');
	return { book };
};
