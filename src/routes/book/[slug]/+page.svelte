<script lang="ts">
	import BookCard from '#lib/BookCard.svelte';

	let { data } = $props();
	const book = $derived(data.book);
</script>

<svelte:head>
	<title>{book.title} · Library</title>
	<meta
		name="description"
		content="{book.title}{book.authors.length ? ` by ${book.authors.join(', ')}` : ''}, in Kristian Bjørnard’s design library."
	/>
</svelte:head>

<nav class="px-[clamp(1.5rem,6vw,6rem)] pt-6 text-sm">
	<a href="/" class="inline-block py-3">← All the books</a>
</nav>

<main class="grid place-items-center px-[clamp(1rem,6vw,6rem)] pt-6 pb-24">
	<BookCard {book} />
</main>
