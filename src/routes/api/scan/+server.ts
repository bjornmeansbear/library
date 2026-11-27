// GET  /api/scan?isbn=…   the book for an ISBN, and whether it's already here
// GET  /api/scan?q=…      no ISBN: editions matching a title (and author)
// POST /api/scan          { isbn, where, format }: add it, whatever is or isn't known
// POST /api/scan          { book, where, format }: add an edition picked from a search
// Both need the passphrase (the Worker secret SCAN_KEY) in the x-scan-key header.
import { json, error } from '@sveltejs/kit';
import { env as workerEnv } from 'cloudflare:workers';
import { lookup, add, search, addFound } from '#lib/server/scan.ts';
import type { RequestHandler } from './$types';

// The Worker's own variables (its secrets), straight from the runtime.
const env = workerEnv as unknown as { NOTION_TOKEN?: string; SCAN_KEY?: string };

export const prerender = false;

function secrets(request: Request) {
	if (!env.NOTION_TOKEN || !env.SCAN_KEY) error(503, 'The scan page isn’t set up: NOTION_TOKEN and SCAN_KEY are missing.');
	const given = request.headers.get('x-scan-key') ?? '';
	// Compare without stopping at the first different character.
	const a = new TextEncoder().encode(given), b = new TextEncoder().encode(env.SCAN_KEY);
	let diff = a.length ^ b.length;
	for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
	if (diff) error(401, 'Wrong passphrase.');
	return env.NOTION_TOKEN;
}

export const GET: RequestHandler = async ({ url, request }) => {
	const token = secrets(request);
	const q = url.searchParams.get('q');
	return json(q != null ? await search(token, q) : await lookup(token, url.searchParams.get('isbn') ?? ''));
};

export const POST: RequestHandler = async ({ request }) => {
	const token = secrets(request);
	const body = (await request.json()) as any;
	return json(body.book ? await addFound(token, body) : await add(token, body));
};
