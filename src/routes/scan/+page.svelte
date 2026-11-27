<script lang="ts">
	// /scan: add a book to the library from a phone. Point the camera at the
	// barcode (or type the ISBN), see the book it found as the card the
	// library pulls off the shelf, pick where it lives, stamp it in. The
	// lookup and the add happen in the Worker (src/routes/api/scan), which
	// holds the Notion token; this page only ever holds the passphrase.
	import { onDestroy } from 'svelte';
	import BookCard from '#lib/BookCard.svelte';
	import type { Book } from '#lib/library.ts';

	type Found = {
		isbn?: string;
		error?: string;
		where?: string[];
		formats?: string[];
		have?: { title: string; url: string };
		unknown?: boolean;
		book?: { title: string; subtitle: string | null; authors: string[]; publisher: string | null; year: string | null; pages: number | null };
		twin?: { title: string; url: string } | null;
	};

	const KEY = 'library-scan-key', WHERE = 'library-scan-where';
	let key = $state(typeof localStorage === 'undefined' ? '' : (localStorage.getItem(KEY) ?? ''));
	let keyInput = $state('');
	let isbn = $state('');
	let status = $state('');
	let busy = $state(false);
	let adding = $state(false);
	let found = $state<Found | null>(null);
	let added = $state<{ title: string; url: string; authors: string[]; publisher: string } | null>(null);
	let where = $state(typeof localStorage === 'undefined' ? '' : (localStorage.getItem(WHERE) ?? ''));
	let format = $state('Book');
	let title = $state('');
	let publisher = $state('');

	// ---- the camera ----
	let video = $state<HTMLVideoElement>();
	let stream: MediaStream | null = null;
	let scanning = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;

	async function startCamera() {
		status = '';
		try {
			// iPhone Safari can't read barcodes by itself; this reads them in
			// WebAssembly, from a file on this site rather than a CDN.
			const [{ BarcodeDetector, setZXingModuleOverrides }, { default: wasmUrl }] = await Promise.all([
				import('barcode-detector/ponyfill'),
				import('zxing-wasm/reader/zxing_reader.wasm?url')
			]);
			setZXingModuleOverrides({ locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) });
			const detector = new BarcodeDetector({ formats: ['ean_13'] });
			stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
			scanning = true;
			await Promise.resolve();
			if (!video) return;
			video.srcObject = stream;
			await video.play();
			const look = async () => {
				if (!scanning || !video) return;
				try {
					const codes = await detector.detect(video);
					const code = codes.map((c) => c.rawValue).find((v) => /^97[89]\d{10}$/.test(v));
					if (code) {
						stopCamera();
						isbn = code;
						navigator.vibrate?.(40);
						return lookup();
					}
				} catch {}
				timer = setTimeout(look, 250);
			};
			look();
		} catch (e) {
			stopCamera();
			status = 'The camera didn’t start. Allow camera access for this site, or type the ISBN.';
		}
	}
	function stopCamera() {
		scanning = false;
		clearTimeout(timer);
		stream?.getTracks().forEach((t) => t.stop());
		stream = null;
	}
	onDestroy(stopCamera);

	// ---- the lookup and the add ----
	async function call(method: 'GET' | 'POST', body?: object) {
		const res = await fetch(method === 'GET' ? `/api/scan?isbn=${encodeURIComponent(isbn)}` : '/api/scan', {
			method,
			headers: { 'x-scan-key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
			body: body ? JSON.stringify(body) : undefined
		});
		if (res.status === 401) {
			localStorage.removeItem(KEY);
			key = '';
			throw new Error('That passphrase didn’t work. Enter it again.');
		}
		if (!res.ok) throw new Error((await res.text()) || `Something went wrong (${res.status}).`);
		return res.json();
	}

	async function lookup() {
		if (!isbn.trim()) return;
		busy = true;
		found = added = null;
		status = 'Looking it up…';
		try {
			found = (await call('GET')) as Found;
			status = found?.error ?? '';
			if (found?.where?.length && !found.where.includes(where)) where = '';
		} catch (e) {
			status = (e as Error).message;
		}
		busy = false;
	}

	async function addIt() {
		if (!found?.isbn) return;
		busy = adding = true;
		status = '';
		try {
			const r = (await call('POST', { isbn: found.isbn, where, format, title, publisher })) as { error?: string; added: { title: string; url: string; authors: string[]; publisher: string } };
			if (r.error) status = r.error;
			else {
				added = r.added;
				localStorage.setItem(WHERE, where);
				found = null;
				status = `Added “${r.added.title}”.`;
				isbn = title = publisher = '';
			}
		} catch (e) {
			status = (e as Error).message;
		}
		busy = adding = false;
	}

	function saveKey(e: SubmitEvent) {
		e.preventDefault();
		key = keyInput.trim();
		localStorage.setItem(KEY, key);
		keyInput = '';
	}

	// The found book as the library's card: a pale tint picked from the ISBN.
	const TINTS = ['pink-1', 'goldenrod-1', 'cornflower-1', 'green-2', 'orange-1', 'violet-1'];
	const asBook = (f: Found): Book => ({
		id: f.isbn!, slug: f.isbn!, title: f.book!.title, format: 'book', subtitle: f.book!.subtitle,
		authors: f.book!.authors, publishers: f.book!.publisher ? [f.book!.publisher] : [], tags: [],
		year: f.book!.year, isbn10: null, isbn13: f.isbn!, where: null, notes: null, pages: f.book!.pages,
		height: 9, thickness: 1, measured: false, sized: 'guessed',
		tint: TINTS[Number(f.isbn!.slice(-4)) % TINTS.length], face: 'work-sans', shelf: null, position: null
	});
</script>

<svelte:head>
	<title>Add a book · Library</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="mx-auto max-w-tablet px-6 pt-[clamp(1.5rem,5vw,4rem)] pb-24">
	<p class="m-0 text-sm"><a href="/">Library</a></p>
	<h1 class="mt-2 mb-6 text-[clamp(2.5rem,1rem+8vw,5rem)] leading-[0.95] tracking-[-0.02em]">Add a book</h1>

	{#if !key}
		<form class="flex flex-wrap items-end gap-x-4 gap-y-2" onsubmit={saveKey}>
			<label class="flex flex-[1_1_14rem] flex-col gap-1 text-sm">
				Passphrase
				<input type="password" bind:value={keyInput} autocomplete="current-password" required
					class="w-full border-2 border-text bg-bg px-2 py-2 text-base" />
			</label>
			<button class="border-2 border-text bg-bg px-4 py-2 text-base font-semibold hover:bg-text hover:text-bg">Unlock</button>
		</form>
		<p class="mt-3 text-sm">Only for adding books to Kristian’s library. This phone remembers it.</p>
	{:else}
		<!-- The ISBN on its own line, then the two ways to find the book side by
		     side, half and half. -->
		<form class="flex flex-col gap-3" onsubmit={(e) => (e.preventDefault(), lookup())}>
			<label class="flex flex-col gap-1 text-sm">
				ISBN
				<input bind:value={isbn} inputmode="numeric" autocomplete="off" placeholder="978…"
					class="w-full border-2 border-text bg-bg px-2 py-2 text-base tabular-nums" />
			</label>
			<div class="grid grid-cols-2 gap-3">
				<button class="w-full border-2 border-text bg-bg px-2 py-2 text-base font-semibold hover:bg-text hover:text-bg" disabled={busy}>Look it up</button>
				{#if scanning}
					<button type="button" class="w-full border-2 border-text bg-text px-2 py-2 text-base font-semibold text-bg" onclick={stopCamera}>Stop the camera</button>
				{:else}
					<button type="button" class="w-full border-2 border-text bg-bg px-2 py-2 text-base font-semibold hover:bg-text hover:text-bg" onclick={startCamera} disabled={busy}>Scan the barcode</button>
				{/if}
			</div>
		</form>

		{#if scanning}
			<!-- svelte-ignore a11y_media_has_caption -->
			<video bind:this={video} playsinline muted class="mt-4 block aspect-[4/3] w-full border-2 border-text bg-text object-cover"></video>
			<p class="mt-2 text-sm">Hold the barcode on the back of the book in the middle of the frame.</p>
		{/if}

		<p class="mt-4 min-h-6 text-sm" aria-live="polite">{status}</p>

		{#if found?.have}
			<p class="mt-2">Already in the library: <a href={found.have.url}>{found.have.title}</a>.</p>
		{:else if found?.isbn && (found.book || found.unknown)}
			<div class="mt-8">
				{#if found.book}
					<BookCard book={asBook(found)}>
						{#snippet bottom()}
							{@render controls()}
						{/snippet}
					</BookCard>
				{:else}
					<p class="m-0">Open Library doesn’t know {found.isbn}. Give it a title and a publisher:</p>
					<div class="mt-4 flex flex-col gap-3">
						<label class="flex flex-col gap-1 text-sm">Title
							<input bind:value={title} required class="w-full border-2 border-text bg-bg px-2 py-2 text-base" /></label>
						<label class="flex flex-col gap-1 text-sm">Publisher
							<input bind:value={publisher} required class="w-full border-2 border-text bg-bg px-2 py-2 text-base" /></label>
					</div>
					{@render controls()}
				{/if}
			</div>
		{/if}

		{#if added}
			<p class="mt-6">
				<a href={added.url}>{added.title}</a> is in Notion: {added.authors.join(', ') || 'no author listed'}, {added.publisher}.
				It shows on the site after the next sync.
			</p>
		{/if}
	{/if}
</main>

{#snippet controls()}
	<div class="mt-6 flex flex-col gap-4 border-t-2 border-[var(--wjerk-black)] pt-4">
		{#if found?.twin}
			<p class="m-0 text-sm">
				This might already be here as <a href={found.twin.url}>{found.twin.title}</a>, under another ISBN.
			</p>
		{/if}
		<div class="flex flex-wrap gap-x-4 gap-y-3">
			<label class="flex flex-[1_1_12rem] flex-col gap-1 text-sm">
				Where it lives
				<select bind:value={where} class="w-full border-2 border-[var(--wjerk-black)] bg-[var(--wjerk-white)] px-2 py-2 text-base text-[var(--wjerk-black)]">
					<option value="">Not set</option>
					{#each found?.where ?? [] as w (w)}<option value={w}>{w}</option>{/each}
				</select>
			</label>
			<label class="flex flex-[0_1_9rem] flex-col gap-1 text-sm">
				It’s a
				<select bind:value={format} class="w-full border-2 border-[var(--wjerk-black)] bg-[var(--wjerk-white)] px-2 py-2 text-base text-[var(--wjerk-black)]">
					{#each found?.formats?.length ? found.formats : ['Book'] as f (f)}<option value={f}>{f}</option>{/each}
				</select>
			</label>
		</div>
		<button type="button" class="stamp-all self-start" onclick={addIt} aria-busy={adding}
			disabled={busy || (found?.unknown && (!title || !publisher))}>
			{adding ? 'Adding it…' : 'Add it to the library'}
		</button>
		<p class="m-0 text-sm" role="status">
			{#if adding}Finding its size and putting it in Notion. This takes a few seconds.{:else if status && found}{status}{/if}
		</p>
	</div>
{/snippet}

<style>
	/* While it's being added the stamp stays pressed: the colours swap, the
	   way every Wjerk control shows it's been pressed. */
	:global(.stamp-all[aria-busy='true']) {
		background: var(--wjerk-white);
		color: var(--wjerk-navy);
		cursor: progress;
	}
</style>
