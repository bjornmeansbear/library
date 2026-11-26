// Fill in missing details in Notion from Open Library, by ISBN-13.
//
//   npm run fill             look everything up, write FILL-PLAN.md to read
//   npm run fill -- --apply  write exactly that plan to Notion
//
// Only ever fills EMPTY fields: Subtitle, Year, Author, Publisher and LOC
// Call Number. Never overwrites anything already typed. Authors and
// publishers are matched against the existing pages (ignoring case,
// punctuation and "Inc."/"Press"); a page is created only when there's no
// match, and the plan marks those "(new)". To skip a change, delete it from
// data/fill-plan.json before applying.
import fs from 'node:fs';
import path from 'node:path';
import { DS, api, queryAll, text, titleOf, rich, nameIndex, findOrCreate, nameKey } from './lib/notion.mjs';
import { edition } from './lib/openlibrary.mjs';

const root = path.resolve(import.meta.dirname, '..');
const planJson = path.join(root, 'data/fill-plan.json');
const planMd = path.join(root, 'FILL-PLAN.md');
const cachePath = path.join(root, 'data/openlibrary-editions.json');

if (process.argv.includes('--apply')) await applyPlan();
else await makePlan();

async function makePlan() {
	const cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf8')) : {};
	const people = await nameIndex('people');
	const publishers = await nameIndex('publishers');
	const books = await queryAll(DS.books);
	const plan = [];
	let looked = 0, unknown = 0;

	for (const p of books) {
		const pr = p.properties;
		const isbn = text(pr['ISBN-13']);
		const format = pr['Format']?.select?.name ?? 'Book';
		if (!isbn || format !== 'Book') continue;
		const missing = {
			subtitle: !text(pr['Subtitle']),
			year: !text(pr['Year']) || text(pr['Year']) === '0',
			authors: !(pr['Author']?.relation ?? []).length,
			publisher: !(pr['Publisher']?.relation ?? []).length,
			lcc: !text(pr['LOC Call Number'])
		};
		if (!Object.values(missing).some(Boolean)) continue;

		looked++;
		if (!(isbn in cache)) cache[isbn] = await edition(isbn);
		const ol = cache[isbn];
		if (!ol) { unknown++; continue; }

		const title = titleOf(p);
		const changes = {};
		// A subtitle only when the Notion title doesn't already include it.
		if (missing.subtitle && ol.subtitle && !nameKey(title).includes(nameKey(ol.subtitle))) changes.subtitle = ol.subtitle;
		if (missing.year && ol.year) changes.year = ol.year;
		if (missing.lcc && ol.lcc) changes.lcc = ol.lcc;
		if (missing.authors && ol.authors.length) {
			changes.authors = [];
			for (const a of ol.authors) changes.authors.push(await findOrCreate('people', a, people, { create: false }));
		}
		if (missing.publisher && ol.publishers.length) {
			changes.publisher = await findOrCreate('publishers', ol.publishers[0], publishers, { create: false });
		}
		if (Object.keys(changes).length) plan.push({ id: p.id, url: p.url, title, isbn, openLibrary: `https://openlibrary.org${ol.key}`, changes });
	}

	fs.writeFileSync(cachePath, JSON.stringify(cache, null, '\t') + '\n');
	fs.writeFileSync(planJson, JSON.stringify(plan, null, '\t') + '\n');

	const count = (k) => plan.filter((r) => r.changes[k]).length;
	const newNames = new Set(plan.flatMap((r) => [...(r.changes.authors ?? []), r.changes.publisher].filter((x) => x?.created).map((x) => x.name)));
	const show = (r) => {
		const c = r.changes, bits = [];
		if (c.subtitle) bits.push(`**Subtitle** ${c.subtitle}`);
		if (c.year) bits.push(`**Year** ${c.year}`);
		if (c.authors) bits.push(`**Author** ${c.authors.map((a) => a.name + (a.created ? ' (new)' : '')).join(', ')}`);
		if (c.publisher) bits.push(`**Publisher** ${c.publisher.name}${c.publisher.created ? ' (new)' : ''}`);
		if (c.lcc) bits.push(`**LOC** ${c.lcc}`);
		return `- [${r.title}](${r.url}) · [Open Library](${r.openLibrary})<br>${bits.join(' · ')}`;
	};
	fs.writeFileSync(planMd, `# Fill plan

Generated ${new Date().toISOString().slice(0, 10)} by \`npm run fill\`. Nothing has been written to Notion yet.

Open Library has details for **${plan.length} books** that are empty in Notion. It only fills empty fields; nothing you typed is changed.

- Subtitles: ${count('subtitle')}
- Years: ${count('year')}
- Authors: ${count('authors')}
- Publishers: ${count('publisher')}
- Library of Congress call numbers: ${count('lcc')}
- New author or publisher pages it would create: ${newNames.size}${newNames.size ? ` (${[...newNames].sort().join(', ')})` : ''}

${looked} books with an ISBN-13 had something missing; Open Library didn't know ${unknown} of them.

**To write it:** \`npm run fill -- --apply\`. To leave a change out, delete it from \`data/fill-plan.json\` first.

${plan.map(show).join('\n')}
`);
	console.log(`plan: ${plan.length} books (${count('subtitle')} subtitles, ${count('year')} years, ${count('authors')} authors, ${count('publisher')} publishers, ${count('lcc')} call numbers, ${newNames.size} new names) → FILL-PLAN.md`);
}

async function applyPlan() {
	if (!fs.existsSync(planJson)) throw new Error('No plan yet: run `npm run fill` first.');
	const plan = JSON.parse(fs.readFileSync(planJson, 'utf8'));
	const people = await nameIndex('people');
	const publishers = await nameIndex('publishers');
	let n = 0;
	for (const r of plan) {
		// Re-read the page: if someone filled a field since the plan was made,
		// theirs wins.
		const page = await api('GET', `pages/${r.id}`);
		const pr = page.properties;
		const props = {};
		const c = r.changes;
		if (c.subtitle && !text(pr['Subtitle'])) props['Subtitle'] = rich(c.subtitle);
		if (c.year && (!text(pr['Year']) || text(pr['Year']) === '0')) props['Year'] = rich(c.year);
		if (c.lcc && !text(pr['LOC Call Number'])) props['LOC Call Number'] = rich(c.lcc);
		if (c.authors && !(pr['Author']?.relation ?? []).length) {
			const ids = [];
			for (const a of c.authors) ids.push((await findOrCreate('people', a.name, people, { create: true })).id);
			props['Author'] = { relation: ids.map((id) => ({ id })) };
		}
		if (c.publisher && !(pr['Publisher']?.relation ?? []).length) {
			props['Publisher'] = { relation: [{ id: (await findOrCreate('publishers', c.publisher.name, publishers, { create: true })).id }] };
		}
		if (Object.keys(props).length) {
			await api('PATCH', `pages/${r.id}`, { properties: props });
			n++;
		}
	}
	console.log(`Wrote details to ${n} books in Notion. Run \`node scripts/data.mjs\` (or wait for the nightly sync) to update the site.`);
}
