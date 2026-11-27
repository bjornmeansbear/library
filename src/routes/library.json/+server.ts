// The whole catalog as plain JSON, at /library.json: the same file the
// site is built from. Open data, linked from the footer.
import { json } from '@sveltejs/kit';
import data from '#lib/data/library.json';

export const prerender = true;

export function GET() {
	return json(data);
}
