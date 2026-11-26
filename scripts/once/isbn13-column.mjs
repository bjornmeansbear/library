// One-off, 2026-11-26: copy each book's cleaned-up ISBN-13 (from the old
// number ISBN column, kept only where the check digit worked out) into the
// new "ISBN-13" text column. Skips books that already have one.
//   node scripts/once/isbn13-column.mjs [--limit N]
import fs from 'node:fs';
const token = fs.readFileSync('.env', 'utf8').match(/NOTION_TOKEN\s*=\s*"?([^"\n]+)/)[1];
const H = { Authorization: `Bearer ${token}`, 'Notion-Version': '2025-09-03', 'Content-Type': 'application/json' };
const limit = Number(process.argv[process.argv.indexOf('--limit') + 1]) || Infinity;
const books = JSON.parse(fs.readFileSync('src/lib/data/library.json', 'utf8')).books.filter((b) => b.isbn13);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let done = 0, skipped = 0;
for (const b of books.slice(0, limit)) {
	const page = await (await fetch(`https://api.notion.com/v1/pages/${b.id}`, { headers: H })).json();
	const now = (page.properties?.['ISBN-13']?.rich_text ?? []).map((t) => t.plain_text).join('');
	if (now) { skipped++; continue; }
	for (let attempt = 0; ; attempt++) {
		const res = await fetch(`https://api.notion.com/v1/pages/${b.id}`, {
			method: 'PATCH', headers: H,
			body: JSON.stringify({ properties: { 'ISBN-13': { rich_text: [{ text: { content: b.isbn13 } }] } } })
		});
		if (res.status === 429 && attempt < 5) { await sleep(1500); continue; }
		if (!res.ok) { console.error(`${res.status} on "${b.title}": ${(await res.text()).slice(0, 200)}`); process.exit(1); }
		break;
	}
	done++;
	await sleep(340);
}
console.log(`wrote ${done}, already set ${skipped}`);
