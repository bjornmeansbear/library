<script lang="ts">
	import Spine from '#lib/Spine.svelte';
	import BookDialog from '#lib/BookDialog.svelte';
	import { books, bySlug, generated, tags, type Book } from '#lib/library.ts';
	import { goto, pushState, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { browser } from '$app/env';

	let query = $state('');

	// Clicking a spine opens the book as a card over the bookcase, without
	// leaving the page: the address becomes /book/<slug> (so it can be shared,
	// and Back closes it). Cmd/Ctrl/Shift-click still opens the full page.
	const open = $derived(page.state.book ? (bySlug.get(page.state.book) ?? null) : null);

	function pick(e: MouseEvent) {
		const a = (e.target as Element).closest('a.spine') as HTMLAnchorElement | null;
		if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
		e.preventDefault();
		const slug = a.pathname.split('/').pop()!;
		pushState(a.pathname, { book: slug });
	}

	// Previous / next among the books on show (so it follows the filter too).
	function step(by: -1 | 1) {
		if (!open) return;
		const list = books.filter((b) => shown.has(b.slug));
		const i = list.findIndex((b) => b.slug === open.slug);
		const next = list[(i + by + list.length) % list.length];
		replaceState(`/book/${next.slug}`, { book: next.slug });
	}

	// A facet from a book card's link: /?publisher=Walker%20Art%20Center shows
	// only that publisher's books. Read in the browser only (pages are
	// prerendered, and a prerendered page has no query string).
	const KINDS = { author: 'authors', publisher: 'publishers', year: 'year', tag: 'tags', format: 'format' } as const;
	type Kind = keyof typeof KINDS;
	const facet = $derived.by(() => {
		if (!browser) return null;
		for (const kind of Object.keys(KINDS) as Kind[]) {
			const value = page.url.searchParams.get(kind);
			if (value) return { kind, value };
		}
		return null;
	});
	const inFacet = (b: Book) => {
		if (!facet) return true;
		const field = b[KINDS[facet.kind]];
		return Array.isArray(field) ? field.includes(facet.value) : field === facet.value;
	};

	// Tags as shelves to browse, from a menu beside the search. Picking one
	// goes to /?tag=…, the same address a tag link on a book card uses. A
	// shelf's intro (from Notion) shows when it's open.
	const shelfHref = (name: string) => `/?tag=${encodeURIComponent(name)}`;
	const currentTag = $derived(facet?.kind === 'tag' ? facet.value : null);
	const intro = $derived(currentTag ? (tags.find((t) => t.name === currentTag)?.intro ?? null) : null);

	const words = $derived(query.toLowerCase().split(/\s+/).filter(Boolean));
	const matches = (b: Book) => {
		if (!inFacet(b)) return false;
		if (!words.length) return true;
		const hay = [b.title, b.subtitle, ...b.authors, ...b.publishers, b.year, ...b.tags]
			.filter(Boolean)
			.join(' ')
			.toLowerCase();
		return words.every((w) => hay.includes(w));
	};
	const shown = $derived(new Set(books.filter(matches).map((b) => b.slug)));

	// The colophon: each face named in itself (RULES.md "Typography: the roster").
	const faces = [
		['work-sans', 'Work Sans', 'Wei Huang'],
		['libre-franklin', 'Libre Franklin', 'Impallari Type'],
		['gentium', 'Gentium Book Plus', 'SIL International'],
		['eb-garamond', 'EB Garamond', 'Georg Duffner and Octavio Pardo'],
		['crimson-pro', 'Crimson Pro', 'Jacques Le Bailly'],
		['newsreader', 'Newsreader', 'Production Type'],
		['plex-mono', 'IBM Plex Mono', 'Mike Abbink and Bold Monday'],
		['league-gothic', 'League Gothic', 'The League of Moveable Type'],
		['young-serif', 'Young Serif', 'Bastien Sozeau'],
		['space-mono', 'Space Mono', 'Colophon Foundry'],
		['bricolage', 'Bricolage Grotesque', 'Mathieu Triay'],
		['fraunces', 'Fraunces', 'Undercase Type'],
		['basteleur', 'Basteleur', 'Keussel, Velvetyne']
	];

	const sized = books.reduce(
		(n, b) => ((n[b.sized] = (n[b.sized] ?? 0) + 1), n),
		{} as Record<string, number>
	);
</script>

<svelte:head>
	<title>Library</title>
	<meta name="description" content="The design books on Kristian Bjørnard’s office shelves, in the order they stand." />
</svelte:head>

<header class="px-[clamp(1.5rem,6vw,6rem)] pt-[clamp(1.5rem,5vw,4rem)]">
	<!-- Phone: one column. From 55rem: title and blurb on the left, finding
	     things (search, shelves) on the right. -->
	<div class="grid gap-x-[clamp(2rem,5vw,5rem)] min-[55rem]:grid-cols-2 min-[55rem]:items-start">
		<div>
			<h1 class="m-0 text-[clamp(3rem,1rem+11vw,12rem)] min-[55rem]:text-[clamp(5rem,1rem+8vw,10rem)] leading-[0.95] tracking-[-0.02em]">Library</h1>
			<p class="mt-4 mb-0 max-w-[36rem]">
				<a href="https://kristian.bjornard.com/">Kristian Bjørnard’s</a> library: {books.length} books, filed by title the way they are on his office shelves! 
			</p>
		</div>
		<div>
			<form class="mt-8 min-[55rem]:mt-0 flex flex-wrap items-end gap-x-4 gap-y-2" role="search" onsubmit={(e) => e.preventDefault()}>
				<label class="flex flex-col gap-1 text-sm">
					Find a book
					<input
						type="search"
						bind:value={query}
						placeholder="Title, author, publisher, year, tag"
						class="w-[min(24rem,80vw)] border-2 border-text bg-bg px-2 py-1 text-base placeholder:text-text-muted"
					/>
				</label>
				{#if tags.length}
					<label class="flex flex-col gap-1 text-sm">
						Browse a shelf
						<select
							value={currentTag ?? ''}
							onchange={(e) => goto(e.currentTarget.value ? shelfHref(e.currentTarget.value) : '/')}
							class="w-[min(16rem,80vw)] border-2 border-text bg-bg px-2 py-1 text-base"
						>
							<option value="">All {books.length} books</option>
							<optgroup label="Shelves">
								{#each tags.filter((t) => t.count > 1) as t (t.name)}
									<option value={t.name}>{t.name} ({t.count})</option>
								{/each}
							</optgroup>
							<optgroup label="One book each">
								{#each tags.filter((t) => t.count === 1) as t (t.name)}
									<option value={t.name}>{t.name}</option>
								{/each}
							</optgroup>
						</select>
					</label>
				{/if}
				<p class="m-0 text-sm" aria-live="polite">
					{#if words.length || facet}
						{shown.size} of {books.length} {shown.size === 1 ? 'book' : 'books'}
					{/if}
				</p>
			</form>

			{#if facet}
				<p class="mt-4 mb-0 flex flex-wrap items-baseline gap-x-4 gap-y-1">
					<span>
						{facet.kind === 'format' ? 'Format:' : facet.kind === 'year' ? 'Published in' : facet.kind === 'tag' ? 'Tagged' : facet.kind === 'author' ? 'By' : 'Published by'}
						<strong>{facet.value}</strong>
					</span>
					<a href="/" class="show-all">Show all the books</a>
				</p>
				{#if intro}<p class="mt-0 mb-0 max-w-[36rem] whitespace-pre-line">{intro}</p>{/if}
			{/if}
		</div>
	</div>
</header>

<!-- The shelves run nearly wall to wall; only the text above and below keeps the wide margins. -->
<main class="bookcase px-[clamp(0.5rem,1.5vw,1rem)] pb-12">
	<h2 class="visually-hidden">Books, A to Z</h2>
	<!-- One listener for every spine; the spines themselves are links, so
	     keyboard users get the same thing with Enter. -->
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
	<ul class="board mt-4" onclick={pick}>
		{#each books as book (book.slug)}
			<li hidden={!shown.has(book.slug)}><Spine {book} /></li>
		{/each}
		<li class="rest" role="presentation"></li>
	</ul>

	{#if words.length && shown.size === 0}
		<p class="mt-12">Nothing here matches “{query}”.</p>
	{/if}
</main>

<BookDialog book={open} onclose={() => history.back()} onstep={step} />

<footer class="px-[clamp(1.5rem,6vw,6rem)] pb-12 text-sm">
	<p class="m-0 max-w-[40rem]">
		Spines are drawn to scale:
		{sized['measured'] ?? 0} measured by hand,
		{sized['open-library'] ?? 0} from Open Library’s dimensions,
		{sized['library-of-congress'] ?? 0} from Library of Congress heights,
		{sized['pages'] ?? 0} estimated from the page count, and
		{sized['guessed'] ?? 0} guessed. Updated {generated}.
	</p>
	<p class="mt-4 mb-0 max-w-[40rem]">
		Spines are set in thirteen open-source typefaces, all under the SIL Open Font License. A
		series shares a face, and so, mostly, does a publisher:
		{#each faces as [cls, name, by], i (cls)}
			<span class="face-{cls} spine-credit">{name}</span> ({by}){i < faces.length - 1 ? ', ' : '.'}
		{/each}
	</p>
</footer>
