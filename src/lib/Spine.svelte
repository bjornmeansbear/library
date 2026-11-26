<script lang="ts">
	import type { Book } from './library';

	let { book, current = false }: { book: Book; current?: boolean } = $props();

	const label = $derived(
		[book.title, book.authors.length ? `by ${book.authors.join(', ')}` : ''].filter(Boolean).join(' ')
	);
</script>

<a
	class="spine face-{book.face}"
	href="/book/{book.slug}"
	style="--h: {book.height}; --t: {book.thickness}; --tint: var(--{book.tint})"
	aria-label={label}
	aria-current={current ? 'page' : undefined}
	title={label}
>
	<span class="spine-title">{book.title}</span>
	{#if book.authors.length}
		<span class="spine-author">{book.authors[0].split(' ').at(-1)}</span>
	{/if}
</a>
