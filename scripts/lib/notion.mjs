// A small Notion API client for the library scripts: reads NOTION_TOKEN from
// .env (or the environment), retries on rate limits, and paces writes to
// stay under Notion's ~3 requests a second.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const envFile = path.join(root, '.env');
if (!process.env.NOTION_TOKEN && fs.existsSync(envFile)) {
	const m = fs.readFileSync(envFile, 'utf8').match(/^\s*NOTION_TOKEN\s*=\s*"?([^"\n]+)"?/m);
	if (m) process.env.NOTION_TOKEN = m[1].trim();
}

export { DS } from './ids.mjs';
import { DS } from './ids.mjs';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function api(method, url, body) {
	if (!process.env.NOTION_TOKEN) throw new Error('NOTION_TOKEN is not set (put it in .env)');
	for (let attempt = 0; ; attempt++) {
		const res = await fetch(`https://api.notion.com/v1/${url}`, {
			method,
			headers: {
				Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
				'Notion-Version': '2025-09-03',
				'Content-Type': 'application/json'
			},
			body: body && JSON.stringify(body)
		});
		if ((res.status === 429 || res.status >= 500) && attempt < 6) {
			await sleep(Number(res.headers.get('retry-after') ?? 1.5) * 1000);
			continue;
		}
		if (!res.ok) throw new Error(`Notion ${res.status} on ${method} ${url}: ${(await res.text()).slice(0, 300)}`);
		if (method === 'PATCH' || (method === 'POST' && url === 'pages')) await sleep(340);
		return res.json();
	}
}

export async function queryAll(dataSource) {
	const out = [];
	let cursor;
	do {
		const r = await api('POST', `data_sources/${dataSource}/query`, { page_size: 100, start_cursor: cursor });
		out.push(...r.results);
		cursor = r.has_more ? r.next_cursor : undefined;
	} while (cursor);
	return out;
}

export const text = (p) => (p?.title ?? p?.rich_text ?? []).map((t) => t.plain_text).join('').trim();
export const titleOf = (page) => text(Object.values(page.properties).find((p) => p.type === 'title'));
export const rich = (s) => ({ rich_text: [{ text: { content: s } }] });

export { nameKey, shortPublisher } from './names.mjs';
import { nameKey, shortPublisher } from './names.mjs';

// Find a person or publisher page by name, or (when create is true) make one.
// Returns { id, name, created }.
export async function findOrCreate(kind, name, index, { create }) {
	const publisher = kind === 'publishers';
	const clean = publisher ? shortPublisher(name) : name.trim();
	const hit = index.get(nameKey(clean, publisher));
	if (hit) return { id: hit.id, name: hit.name, created: false };
	if (!create) return { id: null, name: clean, created: true };
	const page = await api('POST', 'pages', {
		parent: { type: 'data_source_id', data_source_id: DS[kind] },
		properties: { Name: { title: [{ text: { content: clean } }] } }
	});
	const entry = { id: page.id, name: clean };
	index.set(nameKey(clean, publisher), entry);
	return { ...entry, created: true };
}

export async function nameIndex(kind) {
	const publisher = kind === 'publishers';
	const index = new Map();
	for (const p of await queryAll(DS[kind])) {
		const name = titleOf(p);
		const k = nameKey(name, publisher);
		if (k && !index.has(k)) index.set(k, { id: p.id, name });
	}
	return index;
}
