<script lang="ts">
	import type { Snippet } from 'svelte';
	import { bookshopLink, BOOKSHOP_AFFILIATE_ID, type Book } from './library.ts';

	let { book, top, bottom }: { book: Book; top?: Snippet; bottom?: Snippet } = $props();
	const isbn = $derived(book.isbn13 ?? book.isbn10);
	const bookshop = $derived(bookshopLink(book));
	// Shops and Open Library only know books; a film or journal gets a
	// library search by title instead.
	const isBook = $derived(book.format === 'book');
	const FORMAT_NAMES = { book: 'Book', film: 'Film', music: 'Music', journal: 'Journal', zine: 'Zine' };
	const hasDetails = $derived(
		Boolean(!isBook || book.copies || book.publishers.length || book.year || book.pages || isbn || book.tags.length)
	);
	// Each author, publisher, year and tag links back to the bookcase showing
	// only the books that share it.
	const shelfOf = (kind: string, value: string) => `/?${kind}=${encodeURIComponent(value)}`;

	// Where else to find the book, in order: my own notes, buying it,
	// borrowing it, looking it up. Shops and Open Library only know books
	// with an ISBN; anything else gets a library search by title.
	type SeeAlso = { label: string; href: string; text: string; note?: string };
	const seeAlso = $derived.by(() => {
		const rows: SeeAlso[] = [];
		if (book.bjornpaedia) rows.push({ label: 'Notes', href: book.bjornpaedia, text: 'My notes on bjornpaedia' });
		if (isBook && isbn && bookshop)
			rows.push({
				label: 'Buy',
				href: bookshop.url,
				text: bookshop.sure ? 'Bookshop.org' : 'Search Bookshop.org',
				note: BOOKSHOP_AFFILIATE_ID
					? 'An affiliate link: a small share of a sale goes to me and to independent bookstores.'
					: undefined
			});
		rows.push({
			label: 'Borrow',
			href:
				isBook && isbn
					? `https://search.worldcat.org/isbn/${isbn}`
					: `https://search.worldcat.org/search?q=${encodeURIComponent(book.title)}`,
			text: 'Find it in a library'
		});
		if (isBook && isbn) rows.push({ label: 'Look up', href: `https://openlibrary.org/isbn/${isbn}`, text: 'Open Library' });
		return rows;
	});
</script>

{#snippet facets(kind: string, values: string[])}
	{#each values as v, i (v)}<a href={shelfOf(kind, v)}>{v}</a>{i < values.length - 1 ? ', ' : ''}{/each}
{/snippet}

<!-- The book pulled off the shelf: a card in its own spine color, tilted a
     little, with a cream card offset behind it (onething's pile, oblique's
     tilt) instead of a drop shadow. Paper and ink stay the same in dark mode,
     like the spine. -->
<article class="book-card" style="--tint: var(--{book.tint})">
	{@render top?.()}

	<h1 class="m-0 text-2xl">{book.title}</h1>
	{#if book.subtitle}<p class="mt-2 mb-0 text-lg">{book.subtitle}</p>{/if}
	{#if book.authors.length}<p class="mt-4 mb-0 text-md">{@render facets('author', book.authors)}</p>{/if}

	<dl class="mt-6 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 border-t-2 pt-3 text-sm" hidden={!hasDetails}>
		{#if !isBook}
			<dt>Format</dt>
			<dd class="m-0"><a href={shelfOf('format', book.format)}>{FORMAT_NAMES[book.format]}</a></dd>
		{/if}
		{#if book.publishers.length}
			<dt>Publisher</dt>
			<dd class="m-0">{@render facets('publisher', book.publishers)}</dd>
		{/if}
		{#if book.year}
			<dt>Year</dt>
			<dd class="m-0">{@render facets('year', [book.year])}</dd>
		{/if}
		{#if book.pages}
			<dt>Pages</dt>
			<dd class="m-0">{book.pages}</dd>
		{/if}
		{#if book.copies}
			<dt>Copies</dt>
			<dd class="m-0">{book.copies}</dd>
		{/if}
		{#if isbn}
			<dt>ISBN</dt>
			<dd class="m-0 tabular-nums">{isbn}</dd>
		{/if}
		{#if book.tags.length}
			<dt>Tags</dt>
			<dd class="m-0">{@render facets('tag', book.tags)}</dd>
		{/if}
	</dl>

	{#if book.notes}
		<p class="mt-6 mb-0 whitespace-pre-line">{book.notes}</p>
	{/if}

	<!-- See also: where else the book can be found, like the cross-references
	     at the foot of a catalog card. Same ruled two columns as the details. -->
	{#if seeAlso.length}
		<dl class="mt-6 mb-0 grid grid-cols-[auto_1fr] gap-x-6 border-t-2 pt-3 text-sm">
			{#each seeAlso as row (row.label)}
				<dt class="py-1">{row.label}</dt>
				<dd class="m-0 py-1">
					<a href={row.href}>{row.text}</a>
					{#if row.note}<span class="mt-1 block text-xs">{row.note}</span>{/if}
				</dd>
			{/each}
		</dl>
	{/if}

	{@render bottom?.()}
</article>

<style>
	.book-card {
		position: relative;
		box-sizing: border-box;
		width: min(40rem, 100%);
		padding: clamp(1.5rem, 4vw, 2.25rem);
		color: var(--wjerk-black);
		transform: rotate(-1deg);
	}
	/* Both cards are layers under the text. The rotate makes the article its
	   own stacking context, so its own background would paint *under* these;
	   drawing the face as ::after (later, so on top of ::before) keeps the
	   order right. Behind: cream, offset down and right. Front: the spine
	   color. Square, ruled, no shadow. */
	.book-card::before,
	.book-card::after {
		content: '';
		position: absolute;
		inset: 0;
		z-index: -1;
		border: 2px solid var(--wjerk-black);
	}
	.book-card::before {
		background: var(--wjerk-white);
		transform: translate(0.75rem, 0.75rem) rotate(2deg);
	}
	.book-card::after {
		background: var(--tint);
	}
	.book-card :global(dl) {
		border-color: var(--wjerk-black);
	}
	.book-card :global(a) {
		color: var(--wjerk-black);
	}
	/* The kit's pink ring can disappear on a pink spine color; ink always shows. */
	.book-card :global(:focus-visible) {
		outline-color: var(--wjerk-black);
	}
</style>
