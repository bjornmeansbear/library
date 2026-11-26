// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		interface PageState {
			/** slug of the book open in the popup over the bookcase */
			book?: string;
		}
		// interface Platform {}
	}
}

export {};
