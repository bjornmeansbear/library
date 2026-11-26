<script lang="ts">
	import BookCard from './BookCard.svelte';
	import type { Book } from './library.ts';

	// `book` null means closed. The page owns history: onclose asks it to go
	// back, onstep to show the previous or next book.
	let {
		book,
		onclose,
		onstep
	}: { book: Book | null; onclose: () => void; onstep: (by: -1 | 1) => void } = $props();

	let dialog: HTMLDialogElement;

	$effect(() => {
		if (book && !dialog.open) dialog.showModal();
		if (!book && dialog.open) dialog.close();
	});

	function keydown(e: KeyboardEvent) {
		if (e.key === 'ArrowLeft') onstep(-1);
		if (e.key === 'ArrowRight') onstep(1);
	}
</script>

<!-- A native modal: focus stays inside, the page behind is inert, Esc closes.
     A click on the backdrop (the dialog itself, outside the card) closes too. -->
<dialog
	bind:this={dialog}
	class="book-dialog"
	aria-label={book?.title}
	onclose={() => book && onclose()}
	onclick={(e) => e.target === dialog && dialog.close()}
	onkeydown={keydown}
>
	{#if book}
		{#key book.slug}
			<div class="settle">
				<BookCard {book}>
					{#snippet top()}
						<form method="dialog" class="mb-4 flex justify-end">
							<button class="close">Close</button>
						</form>
					{/snippet}
					{#snippet bottom()}
						<nav class="mt-6 flex justify-between gap-4 border-t-2 border-[var(--wjerk-black)] pt-3 text-sm" aria-label="Along the shelf">
							<button class="step" onclick={() => onstep(-1)}>← Previous</button>
							<button class="step" onclick={() => onstep(1)}>Next →</button>
						</nav>
					{/snippet}
				</BookCard>
			</div>
		{/key}
	{/if}
</dialog>

<style>
	.book-dialog {
		border: 0;
		padding: clamp(1rem, 4vw, 3rem) clamp(1rem, 4vw, 3rem) clamp(2rem, 6vw, 4rem);
		margin: auto;
		width: min(44rem, 100vw);
		max-width: 100vw;
		max-height: 100dvh;
		background: transparent;
		overflow: auto;
	}
	/* The bookcase stays in view behind, washed back toward the ground
	   rather than blurred. */
	.book-dialog::backdrop {
		background: color-mix(in srgb, var(--color-bg) 78%, transparent);
	}
	.close,
	.step {
		font: inherit;
		color: var(--wjerk-black);
		background: transparent;
		border: 2px solid var(--wjerk-black);
		padding: 0.5rem 0.75rem;
		min-height: 2.75rem;
		cursor: pointer;
	}
	.close:hover,
	.step:hover,
	.close:active,
	.step:active {
		background: var(--wjerk-black);
		color: var(--tint);
	}

	/* Pulled from the shelf: it rises and settles into its tilt. Motion that
	   says where the card came from; none at all when reduced motion is on. */
	.settle {
		animation: settle 180ms ease-out;
	}
	@keyframes settle {
		from {
			transform: translateY(1.5rem) rotate(3deg);
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.settle {
			animation: none;
		}
	}
</style>
