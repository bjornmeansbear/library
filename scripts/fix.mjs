// Fix typos in the catalog in Notion, from a list in fixes.txt (see the notes
// at its top for the four kinds of line).
//
//   npm run fix                 print what would change
//   npm run fix -- --apply      change it, then `npm run sync`
//   npm run fix -- other.txt    read another list
//
// People and publishers are fixed by renaming their page, so every book that
// links to it is fixed at once. When a page with the right name already
// exists, the books move to it and the misspelled page goes to Notion's trash
// (restorable for 30 days). Each plan line names the books it touches: read
// them before --apply, in case a name belongs to more than one person.
// A fix that's already done says so and changes nothing.
import fs from 'node:fs';
import { api, DS, queryAll, rich, text, titleOf } from './lib/notion.mjs';

const apply = process.argv.includes('--apply');
const file = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'fixes.txt';
const KINDS = { person: 'people', publisher: 'publishers' };
const FIELD = { people: 'Author', publishers: 'Publisher' };

const fixes = [];
for (const [n, raw] of fs.readFileSync(file, 'utf8').split('\n').entries()) {
	const line = raw.trim();
	if (!line || line.startsWith('#') || line.startsWith('ok:')) continue; // ok: lines are for npm run typos
	const m = line.match(/^(person|publisher|title|isbn):\s*(.+?)\s*(?:→|->)\s*(.+)$/);
	if (!m) {
		console.log(`  ? line ${n + 1} isn't a fix: "${line}"`);
		continue;
	}
	fixes.push({ kind: m[1], from: m[2], to: m[3] });
}

const straight = (s) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
const same = (a, b) => straight(a).trim() === straight(b).trim();
const titleProp = (page) => Object.entries(page.properties).find(([, p]) => p.type === 'title')[0];
const short = (t) => (t.length > 60 ? t.slice(0, 57) + '…' : t);

const books = await queryAll(DS.books);
const pages = {};
const plan = [];
const done = [];

// People and publishers
for (const { kind, from, to } of fixes.filter((f) => KINDS[f.kind])) {
	const ds = KINDS[kind];
	pages[ds] ??= await queryAll(DS[ds]);
	const wrong = pages[ds].filter((p) => same(titleOf(p), from));
	const right = pages[ds].find((p) => same(titleOf(p), to));
	if (!wrong.length) {
		if (right) done.push(`${kind}: ${to}`);
		else console.log(`  ? no ${kind} named "${from}" (or "${to}")`);
		continue;
	}
	if (wrong.length > 1) {
		console.log(`  ? ${wrong.length} ${kind} pages are named "${from}"; merge them in Notion first`);
		continue;
	}
	const page = wrong[0];
	const theirs = books.filter((b) => (b.properties[FIELD[ds]]?.relation ?? []).some((r) => r.id === page.id));
	const which = theirs.map((b) => short(titleOf(b))).join('; ') || 'no books';
	if (right) {
		plan.push({
			say: `${kind}: merge "${from}" into "${to}" (${which}); "${from}" goes to the trash`,
			run: async () => {
				for (const b of theirs) {
					const ids = b.properties[FIELD[ds]].relation.map((r) => (r.id === page.id ? right.id : r.id));
					await api('PATCH', `pages/${b.id}`, { properties: { [FIELD[ds]]: { relation: [...new Set(ids)].map((id) => ({ id })) } } });
				}
				await api('PATCH', `pages/${page.id}`, { in_trash: true });
			}
		});
	} else {
		plan.push({
			say: `${kind}: "${from}" → "${to}" (${which})`,
			run: () => api('PATCH', `pages/${page.id}`, { properties: { [titleProp(page)]: { title: [{ text: { content: to } }] } } })
		});
	}
}

// Words in titles and subtitles: every fix for a book applied in turn, one edit each.
const edits = new Map();
for (const { from, to } of fixes.filter((f) => f.kind === 'title')) {
	let found = 0;
	for (const b of books) {
		for (const [name, p] of Object.entries(b.properties)) {
			if (p.type !== 'title' && name !== 'Subtitle') continue;
			const key = `${b.id}|${name}`;
			const e = edits.get(key) ?? { book: b, name, type: p.type, before: text(p), after: text(p) };
			if (!e.after.includes(from)) continue;
			e.after = e.after.replaceAll(from, to);
			edits.set(key, e);
			found++;
		}
	}
	if (!found) done.push(`title: ${to}`);
}
for (const { book, name, type, before, after } of edits.values()) {
	plan.push({
		say: `${name === 'Subtitle' ? 'subtitle' : 'title'}: "${before}" → "${after}"`,
		run: () => api('PATCH', `pages/${book.id}`, { properties: { [name]: type === 'title' ? { title: [{ text: { content: after } }] } : rich(after) } })
	});
}

// ISBNs
for (const { from, to } of fixes.filter((f) => f.kind === 'isbn')) {
	const isbn = to.replace(/[^0-9Xx]/g, '');
	const hits = books.filter((b) => straight(titleOf(b)).toLowerCase().startsWith(straight(from).toLowerCase()));
	if (hits.length !== 1) {
		console.log(`  ? ${hits.length ? hits.length + ' books start' : 'no book starts'} "${from}"; make it longer`);
		continue;
	}
	const has = text(hits[0].properties['ISBN-13']);
	if (has === isbn) { done.push(`isbn: ${short(titleOf(hits[0]))}`); continue; }
	if (has) { console.log(`  ? ${titleOf(hits[0])} already has ISBN-13 ${has}; change it in Notion if ${isbn} is right`); continue; }
	plan.push({ say: `isbn: ${short(titleOf(hits[0]))} ← ${isbn}`, run: () => api('PATCH', `pages/${hits[0].id}`, { properties: { 'ISBN-13': rich(isbn) } }) });
}

for (const step of plan) {
	console.log(`  ${apply ? '✓' : '·'} ${step.say}`);
	if (apply) await step.run();
}
console.log(
	`${plan.length} ${plan.length === 1 ? 'change' : 'changes'} ${apply ? 'made' : 'to make'}` +
		(done.length ? `, ${done.length} already done` : '') +
		(plan.length ? (apply ? '. Now `npm run sync`.' : '. Run `npm run fix -- --apply` to make them.') : '.')
);
