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

	// The blurb under the title says what's on show, in a sentence: which
	// shelf, author, search… and how many. It's also what screen readers hear
	// when the shelf changes.
	const FORMAT_PLURAL = { book: 'books', film: 'films', music: 'albums', journal: 'journals', zine: 'zines' } as Record<string, string>;
	const scope = $derived.by(() => {
		const parts: string[] = [];
		if (facet?.kind === 'tag') parts.push(`the ${facet.value} shelf`);
		else if (facet?.kind === 'author') parts.push(`the books by ${facet.value}`);
		else if (facet?.kind === 'publisher') parts.push(`the books from ${facet.value}`);
		else if (facet?.kind === 'year') parts.push(`the books published in ${facet.value}`);
		else if (facet?.kind === 'format') parts.push(`the ${FORMAT_PLURAL[facet.value] ?? facet.value}`);
		if (words.length) parts.push(`${parts.length ? 'matching' : 'everything matching'} “${query.trim()}”`);
		return parts.join(', ');
	});

	// The shelf label: a card on the front of the first board, the way a
	// library labels a shelf. It says what's on show and how many.
	const firstShown = $derived(books.find((b) => shown.has(b.slug))?.slug ?? null);
	const shelfLabel = $derived.by(() => {
		if (!facet && !words.length) return `All ${books.length} books, A to Z`;
		const what = [
			facet && (facet.kind === 'author' ? `By ${facet.value}` : facet.kind === 'year' ? `Published ${facet.value}` : facet.value),
			words.length && `“${query.trim()}”`
		].filter(Boolean);
		return `${what.join(' · ')} · ${shown.size} of ${books.length}`;
	});

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

	// Where else to find Kristian and Wjerk: the list on kristian.bjornard.com.
	const elsewhere = [
		['Contact', 'mailto:wjerkshop@pm.me', 'wjerkshop@pm.me', 'Studio work, talks, workshops.'],
		['Studio', 'https://a.wjerk.shop/', 'a.wjerk.shop', 'Wjerk, a climate-design studio.'],
		['Index', 'https://a.wjerk.shop/works', 'a.wjerk.shop/works', 'Every Wjerk project, in one list.'],
		['About', 'https://kristian.bjornard.com/', 'kristian.bjornard.com', 'Kristian Bjørnard.'],
		['Teaching', 'https://teaching.kristianbjornard.com/', 'teaching.kristianbjornard.com', 'Courses, workshops, lectures and crits.'],
		['Writing', 'https://bjornpaedia.wjerk.shop/', 'bjornpaedia.wjerk.shop', 'Essays and notes.'],
		['Colour', 'https://wjavelength.wjerk.shop/', 'wjavelength.wjerk.shop', 'The Wjerk colour system, and a place to vote on it.'],
		['Newsletter', 'https://buttondown.com/bjornmeansbear', 'buttondown.com/bjornmeansbear', ''],
		['Materials', 'https://github.com/bjornmeansbear', 'github.com/bjornmeansbear', 'Free to take and change.'],
		['Archive', 'https://archive.wjerk.shop/', 'archive.wjerk.shop', 'The old portfolio, 2003–2011.'],
		['Archive', 'https://www.ookb.co/', 'ookb.co', 'The Office of Kristian Bjørnard.'],
		['Elsewhere', 'https://www.instagram.com/bjornmeansbear', 'Instagram', ''],
		['Elsewhere', 'https://www.linkedin.com/in/kristian-bjornard-367561259', 'LinkedIn', '']
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
			<p class="mt-4 mb-0 max-w-[36rem]" aria-live="polite">
				<a href="https://kristian.bjornard.com/">Kristian Bjørnard’s</a> library{#if scope}, <strong>{scope}</strong>{/if}:
				{#if !scope}
					{books.length} books, filed by title the way they are on his office shelves!
				{:else if shown.size}
					<strong>{shown.size}</strong> of {books.length} books, filed by title the way they are on his office shelves.
				{:else}
					nothing here yet.
				{/if}
			</p>
			{#if intro}<p class="mt-4 mb-0 max-w-[36rem] whitespace-pre-line">{intro}</p>{/if}
		</div>
		<div>
			<form class="mt-8 min-[55rem]:mt-0 flex flex-wrap items-end gap-x-4 gap-y-2" role="search" onsubmit={(e) => e.preventDefault()}>
				<label class="flex flex-[1_1_14rem] flex-col gap-1 text-sm">
					Find a book
					<input
						type="search"
						bind:value={query}
						placeholder="Title, author, publisher, year, tag"
						class="w-full border-2 border-text bg-bg px-2 py-1 text-base placeholder:text-text-muted"
					/>
				</label>
				{#if tags.length}
					<label class="flex flex-[0_1_14rem] flex-col gap-1 text-sm">
						Browse a shelf
						<select
							value={currentTag ?? ''}
							onchange={(e) => goto(e.currentTarget.value ? shelfHref(e.currentTarget.value) : '/')}
							class="w-full border-2 border-text bg-bg px-2 py-1 text-base"
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
				<!-- The count shows on the shelf label; this says it to screen readers. -->
			</form>

		</div>
	</div>
</header>

<!-- The way out of a filter or search: a stamp, from wjavelength's yes/no
     votes, slapped on at a tilt over the top-left corner and staying put as
     you scroll. Goldenrod on Wjerk Black, the pairing the votes like best. -->
{#if facet || words.length}
	<button type="button" class="stamp-all" onclick={() => ((query = ''), goto('/'))}>Show all the books</button>
{/if}

<!-- The shelves run nearly wall to wall; only the text above and below keeps the wide margins. -->
<main class="bookcase px-[clamp(0.5rem,1.5vw,1rem)] pb-12">
	<h2 class="visually-hidden">Books, A to Z</h2>
	<!-- One listener for every spine; the spines themselves are links, so
	     keyboard users get the same thing with Enter. -->
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
	<ul class="board mt-4" onclick={pick}>
		{#each books as book (book.slug)}
			<li hidden={!shown.has(book.slug)}>
				<Spine {book} />
				{#if book.slug === firstShown}<span class="shelf-label" aria-hidden="true">{shelfLabel}</span>{/if}
			</li>
		{/each}
		<li class="rest" role="presentation"></li>
	</ul>

	{#if words.length && shown.size === 0}
		<p class="mt-12">Nothing here matches “{query}”.</p>
	{/if}
</main>

<BookDialog book={open} onclose={() => history.back()} onstep={step} />

<!-- The footer, in a.wjerk.shop's order: what this is and how it works, the
     colophon, then everywhere else (the same list as kristian.bjornard.com),
     then the small print. -->
<footer class="site-footer px-[clamp(1.5rem,6vw,6rem)] pt-8 pb-12 text-sm">
	<div class="grid gap-x-[clamp(2rem,5vw,5rem)] gap-y-8 min-[55rem]:grid-cols-2">
		<div class="max-w-[40rem]">
			<h2 class="m-0 text-sm">About</h2>
			<p class="mt-2 mb-0">
				Library is <a href="https://kristian.bjornard.com/">Kristian Bjørnard’s</a> design library: every book on his office shelves, drawn as a
				spine to scale and filed A to Z. A <a href="https://a.wjerk.shop/">Wjerk</a> project.
			</p>
			<p class="mt-4 mb-0">
				The catalogue lives in Notion. Each night a script reads it, looks up page counts and sizes
				in Open Library and the Library of Congress, and rebuilds this page. Of the spines,
				{#if sized['measured']}{sized['measured']} are measured by hand,{/if}
				{(sized['open-library'] ?? 0) + (sized['library-of-congress'] ?? 0)} come from those catalogues,
				{sized['pages'] ?? 0} are estimated from the page count, and
				{sized['guessed'] ?? 0} are guessed. Updated {generated}.
			</p>
			<p class="mt-4 mb-0">
				Spines are set in thirteen open-source typefaces, all under the SIL Open Font License. A
				series shares a face, and so, mostly, does a publisher:
				{#each faces as [cls, name, by], i (cls)}
					<span class="face-{cls} spine-credit">{name}</span> ({by}){i < faces.length - 1 ? ', ' : '.'}
				{/each}
			</p>
		</div>

		<div>
			<h2 class="m-0 text-sm">Elsewhere</h2>
			<ul class="elsewhere">
				{#each elsewhere as [what, href, label, note] (href)}
					<li>
						<span class="what">{what}</span>
						<span><a {href}>{label}</a>{#if note}<span class="note">{note}</span>{/if}</span>
					</li>
				{/each}
			</ul>
		</div>
	</div>

	<p class="small-print mt-8 mb-0">
		Wjerk. 2026. Text CC BY-SA 4.0. Served from Cloudflare; the site’s code is at
		<a href="https://github.com/bjornmeansbear/library">github.com/bjornmeansbear/library</a>.
		Bookshop.org links are affiliate links.
	</p>
</footer>
