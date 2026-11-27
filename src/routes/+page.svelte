<script lang="ts">
	import Spine from '#lib/Spine.svelte';
	import BookDialog from '#lib/BookDialog.svelte';
	import { books, bySlug, generated, shelfTags, tags, type Book } from '#lib/library.ts';
	import { plain } from '../../scripts/lib/typeset.mjs';
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
		if (facet.kind === 'tag') return b.tags.some((t) => shelfTags(facet.value).includes(t));
		const field = b[KINDS[facet.kind]];
		return Array.isArray(field) ? field.includes(facet.value) : field === facet.value;
	};

	// Tags as shelves to browse, from a menu beside the search. Picking one
	// goes to /?tag=…, the same address a tag link on a book card uses. A
	// shelf's intro (from Notion) shows when it's open.
	const shelfHref = (name: string) => `/?tag=${encodeURIComponent(name)}`;
	const currentTag = $derived(facet?.kind === 'tag' ? facet.value : null);
	// The menu lists shelves of five books or more: the long tail of one- and
	// two-book tags would bury them. Those small shelves are still a click away
	// from any book card with that tag, and when one is open the menu shows it.
	const MENU_MIN = 5;
	const menuShelves = $derived(tags.filter((t) => t.count >= MENU_MIN || t.name === currentTag));
	const intro = $derived(currentTag ? (tags.find((t) => t.name === currentTag)?.intro ?? null) : null);

	// Titles carry typographer's marks; a search for don't still finds Don’t.
	const words = $derived(plain(query).toLowerCase().split(/\s+/).filter(Boolean));
	const matches = (b: Book) => {
		if (!inFacet(b)) return false;
		if (!words.length) return true;
		const hay = plain(
			[b.title, b.subtitle, ...b.authors, ...b.publishers, b.year, ...b.tags].filter(Boolean).join(' ')
		).toLowerCase();
		return words.every((w) => hay.includes(w));
	};
	const shown = $derived(new Set(books.filter(matches).map((b) => b.slug)));

	// The blurb under the title says what's on show, in a sentence: which
	// shelf, author, search… and how many. It's also what screen readers hear
	// when the shelf changes.
	const FORMAT_PLURAL = { book: 'books', film: 'films', music: 'albums', journal: 'journals', zine: 'zines' } as Record<string, string>;
	const scope = $derived.by(() => {
		const parts: string[] = [];
		if (facet?.kind === 'tag') parts.push(`${/^the /i.test(facet.value) ? '' : 'the '}${facet.value} shelf`);
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
	// Grouped, so the column reads as a few kinds of place, not one long list.
	const elsewhere: [string, [string, string][]][] = [
		['Get in touch', [
			['wjerkshop@pm.me', 'mailto:wjerkshop@pm.me'],
			['(443) 917-1420', 'tel:+14439171420']
		]],
		['Wjerk', [
			['The studio', 'https://a.wjerk.shop/'],
			['Every project', 'https://a.wjerk.shop/works'],
			['Wjavelength, the color system', 'https://wjavelength.wjerk.shop/'],
			['Bjornpaedia, the writing', 'https://bjornpaedia.wjerk.shop/']
		]],
		['Kristian Bjørnard', [
			['kristian.bjornard.com', 'https://kristian.bjornard.com/'],
			['Teaching', 'https://teaching.kristianbjornard.com/'],
			['Newsletter', 'https://buttondown.com/bjornmeansbear'],
			['GitHub', 'https://github.com/bjornmeansbear']
		]],
		['Archives', [
			['2003–2011', 'https://archive.wjerk.shop/'],
			['The Office of Kristian Bjørnard', 'https://www.ookb.co/']
		]],
		['Social', [
			['Instagram', 'https://www.instagram.com/bjornmeansbear'],
			['LinkedIn', 'https://www.linkedin.com/in/kristian-bjornard-367561259']
		]]
	];

	const sized = books.reduce(
		(n, b) => ((n[b.sized] = (n[b.sized] ?? 0) + 1), n),
		{} as Record<string, number>
	);
</script>

<svelte:head>
	<title>Library</title>
	<meta name="description" content="The books in Kristian Bjørnard’s library, in alphabetical order." />
</svelte:head>

<header class="px-[clamp(1.5rem,6vw,6rem)] pt-[clamp(1.5rem,5vw,4rem)]">
	<!-- Phone: one column. From 55rem: title and blurb on the left, finding
	     things (search, shelves) on the right. -->
	<div class="grid gap-x-[clamp(2rem,5vw,5rem)] desktop:grid-cols-2 desktop:items-start">
		<div>
			<h1 class="m-0 text-[clamp(3rem,1rem+11vw,12rem)] desktop:text-[clamp(5rem,1rem+8vw,10rem)] leading-[0.95] tracking-[-0.02em]">Library</h1>
			<p class="mt-4 mb-0 max-w-[36rem]" aria-live="polite">
				<a href="https://kristian.bjornard.com/">Kristian Bjørnard’s</a> library{#if scope}, <strong>{scope}</strong>{/if}:
				{#if !scope}
					{books.length} books in alphabetical order.
				{:else if shown.size}
					<strong>{shown.size}</strong> of {books.length} books in alphabetical order.
				{:else}
					nothing here yet.
				{/if}
			</p>
			{#if intro}<p class="mt-4 mb-0 max-w-[36rem] whitespace-pre-line">{intro}</p>{/if}
		</div>
		<div>
			<form class="mt-8 desktop:mt-0 flex flex-wrap items-end gap-x-4 gap-y-2" role="search" onsubmit={(e) => e.preventDefault()}>
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
							{#each menuShelves as t (t.name)}
								<option value={t.name}>{t.name} ({t.count})</option>
							{/each}
						</select>
					</label>
				{/if}
			</form>

			<!-- The way out of a filter or search: a stamp, from wjavelength's
			     yes/no votes, slapped on at a tilt beside the tools that set the
			     filter. Goldenrod on Wjerk Black, the pairing the votes like best. -->
			{#if facet || words.length}
				<button type="button" class="stamp-all" onclick={() => ((query = ''), goto('/'))}>Show all the books</button>
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
			<li hidden={!shown.has(book.slug)}>
				<Spine {book} />
				{#if book.slug === firstShown}<span class="shelf-label" aria-hidden="true">{shelfLabel}</span>{/if}
			</li>
		{/each}
		<!-- The rest of the plank. When nothing matches, the words stand on it,
		     where the books would be. -->
		{#if words.length && shown.size === 0}
			<li class="rest empty">Nothing here matches “{query}”</li>
		{:else}
			<li class="rest" role="presentation"></li>
		{/if}
	</ul>
</main>

<BookDialog book={open} onclose={() => history.back()} onstep={step} />

<!-- The footer, in a.wjerk.shop's order: what this is and how it works, the
     colophon, then everywhere else (the same list as kristian.bjornard.com),
     then the small print. -->
<footer class="site-footer px-[clamp(1.5rem,6vw,6rem)] pb-12 text-sm">
	<div class="grid gap-x-[clamp(2rem,4vw,4rem)] gap-y-8 tablet:grid-cols-2 min-[64rem]:grid-cols-3">
		<div class="max-w-tablet">
			<h2 class="m-0 text-sm">About</h2>
			<p class="mt-2 mb-0">
				Library is <a href="https://kristian.bjornard.com/">Kristian Bjørnard’s</a> design library: every book in his catalog, drawn as a
				spine to scale, in alphabetical order. A <a href="https://a.wjerk.shop/">Wjerk</a> project.
			</p>
			<p class="mt-4 mb-0">
				The catalog lives in Notion. Each night a script reads it, looks up page counts and sizes
				in Open Library and the Library of Congress, and rebuilds this page. Of the spines,
				{#if sized['measured']}{sized['measured']} are measured by hand,{/if}
				{(sized['open-library'] ?? 0) + (sized['library-of-congress'] ?? 0)} come from those catalogs,
				{sized['pages'] ?? 0} are estimated from the page count, and
				{sized['guessed'] ?? 0} are guessed. Updated <span class="whitespace-nowrap">{generated}</span>.
			</p>
			<p class="mt-4 mb-0">
				The whole catalog is open: <a href="/library.json">library.json</a> ({books.length} books,
				plain JSON). Take it, sort it, make something with it.
			</p>
			<p class="mt-4 mb-0">
				Some books anyone can read for free, online: <a href="https://www.are.na/bjornmeansbear/freeonlinebooks">Free Online Books</a>, a channel on Are.na.
			</p>
		</div>

		<div class="max-w-tablet">
			<h2 class="m-0 text-sm">Colophon</h2>
			<p class="mt-2 mb-0">
				Spines are set in thirteen open-source typefaces, all under the SIL Open Font License. A
				series shares a face, and so, mostly, does a publisher:
				{#each faces as [cls, name, by], i (cls)}
					<span class="face-{cls} spine-credit">{name}</span> ({by}){i < faces.length - 1 ? ', ' : '.'}
				{/each}
			</p>
		</div>

		<div>
			<h2 class="m-0 text-sm">Elsewhere</h2>
			<div class="elsewhere">
				{#each elsewhere as [group, links] (group)}
					<section>
						<h3>{group}</h3>
						<ul>
							{#each links as [label, href] (href)}
								<li><a {href}>{label}</a></li>
							{/each}
						</ul>
					</section>
				{/each}
			</div>
		</div>
	</div>

	<p class="small-print mt-8 mb-0">
		Wjerk. 2026. Text and design CC BY-SA 4.0; code Apache 2.0, at
		<a href="https://github.com/bjornmeansbear/library">github.com/bjornmeansbear/library</a>.
		The books themselves, their titles and everything else about them, belong to their authors
		and publishers. Served from Cloudflare. Bookshop.org links are affiliate links.
	</p>
</footer>
