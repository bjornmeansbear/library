// GET  /api/scan?isbn=…   the book for an ISBN, and whether it's already here
// POST /api/scan          { isbn, where, format, title?, publisher?, force? }: add it
// Both need the passphrase (the Worker secret SCAN_KEY) in the x-scan-key header.
import { json, error } from '@sveltejs/kit';
import { env as workerEnv } from 'cloudflare:workers';
import { lookup, add } from '#lib/server/scan.ts';
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
	return json(await lookup(token, url.searchParams.get('isbn') ?? ''));
};

export const POST: RequestHandler = async ({ request }) => {
	const token = secrets(request);
	return json(await add(token, await request.json()));
};
