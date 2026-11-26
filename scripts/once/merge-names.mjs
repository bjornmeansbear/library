// One-off, 2026-11-26: tidy the Authors and Publishers databases.
//
//   - names the original import split at a comma ('"John Wiley & Sons' +
//     'Inc."') are rejoined on every book that has them
//   - duplicates are merged: each book points at one keeper page
//   - publishers lose legal suffixes ("Phaidon Press Limited" → "Phaidon"
//     when that's the shortest name in its group); authors keep "Jr." etc.
//   - pages left with no books and no other links go to Notion's trash
//     (restorable for 30 days). Unused pages that weren't duplicates are
//     left alone.
//
//   node scripts/once/merge-names.mjs          print the plan
//   node scripts/once/merge-names.mjs --apply  do it
import fs from 'node:fs';

const apply = process.argv.includes('--apply');
const token = fs.readFileSync('.env', 'utf8').match(/NOTION_TOKEN\s*=\s*"?([^"\n]+)/)[1];
const H = { Authorization: `Bearer ${token}`, 'Notion-Version': '2025-09-03', 'Content-Type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, url, body) {
	for (let attempt = 0; ; attempt++) {
		const res = await fetch(`https://api.notion.com/v1/${url}`, { method, headers: H, body: body && JSON.stringify(body) });
		if (res.status === 429 && attempt < 6) { await sleep(1500); continue; }
		if (!res.ok) throw new Error(`${res.status} ${method} ${url}: ${(await res.text()).slice(0, 300)}`);
		if (method !== 'GET' && method !== 'POST') await sleep(340);
		return res.json();
	}
}
async function all(ds) {
	const out = [];
	let c;
	do {
		const r = await api('POST', `data_sources/${ds}/query`, { page_size: 100, start_cursor: c });
		out.push(...r.results);
		c = r.has_more ? r.next_cursor : undefined;
	} while (c);
	return out;
}
const titleOf = (p) => Object.values(p.properties).find((x) => x.type === 'title').title.map((x) => x.plain_text).join('').trim();
const titleKey = (p) => Object.entries(p.properties).find(([, x]) => x.type === 'title')[0];

const BOOKS = 'f4d45ea0-fcaf-44cb-a488-5a3e6ba3537f';
const KINDS = [
	{ prop: 'Author', ds: 'dcabd07d-b2e1-4af3-a0cc-51ed47cc1678', publisher: false },
	{ prop: 'Publisher', ds: '9027a079-5e5d-44c5-a5aa-a5b3abfd441a', publisher: true }
];

const LEGAL = /,?\s*\b(inc|ltd|llc|limited)\b\.?$/i;
const clean = (s) => s.replaceAll('"', '').replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim();
const short = (s) => { let t = clean(s); while (LEGAL.test(t)) t = t.replace(LEGAL, '').trim(); return t.replace(/,$/, ''); };
// Grouping key: drops quotes, punctuation, legal suffixes and generic words,
// so "Phaidon", "Phaidon Press Inc." and "Phaidon Press Limited" meet.
const groupKey = (s, publisher) => {
	let k = clean(s).toLowerCase().replace(/[.,&']/g, ' ');
	if (publisher) k = k.replace(/\b(inc|ltd|llc|limited|press|publishers?|publishing|publications?|books?|the|company|co)\b/g, ' ');
	return k.replace(/\s+/g, ' ').trim();
};

const books = await all(BOOKS);
const plan = { renames: [], books: [], trash: [], keptUnused: 0 };

for (const kind of KINDS) {
	const pages = await all(kind.ds);
	const byId = new Map(pages.map((p) => [p.id, p]));
	const name = (id) => titleOf(byId.get(id));

	// 1. Rejoin split names on each book: a sequence of relation entries → names.
	const rejoin = (ids) => {
		const out = [];
		for (let i = 0; i < ids.length; i++) {
			const n = name(ids[i]);
			const next = ids[i + 1] && name(ids[i + 1]);
			if (n.startsWith('"') && next) { out.push({ name: `${n}, ${next}`, from: [ids[i], ids[++i]] }); continue; }
			if (n === 'Little' && next === 'Brown and Company') { out.push({ name: 'Little, Brown and Company', from: [ids[i], ids[++i]] }); continue; }
			// a tail with a stray quote, or one that's only generic words
			// ("Hartley & Marks" + "Publishers", "Prentice-Hall" + "Inc.")
			if ((n.endsWith('"') || !groupKey(n, kind.publisher)) && out.length) { const last = out.at(-1); last.name += `, ${n}`; last.from.push(ids[i]); continue; }
			out.push({ name: n, from: [ids[i]] });
		}
		return out;
	};

	// 2. Group every name in use (whole page names plus rejoined ones).
	const groups = new Map(); // key → { names:Set, pages:Set }
	const add = (n, pageIds) => {
		if (/^\d{8,}$/.test(clean(n))) return;
		const k = groupKey(n, kind.publisher);
		if (!k) return; // "Inc.", "Publishers": only ever half of a name
		const g = groups.get(k) ?? { names: new Set(), pages: new Set() };
		g.names.add(clean(n));
		pageIds.forEach((id) => g.pages.add(id));
		groups.set(k, g);
	};
	for (const p of pages) { const n = titleOf(p); if (!n.startsWith('"') && !n.endsWith('"') && n !== 'Little' && n !== 'Brown and Company') add(n, [p.id]); }
	const bookEntries = books.map((b) => ({ b, ids: (b.properties[kind.prop]?.relation ?? []).map((r) => r.id) }));
	for (const { ids } of bookEntries) for (const e of rejoin(ids)) if (e.from.length > 1) add(e.name, []);

	// 3. A keeper per group: the page whose name is already the display
	//    name if there is one, else the most-used page, renamed.
	const uses = new Map();
	for (const { ids } of bookEntries) for (const id of ids) uses.set(id, (uses.get(id) ?? 0) + 1);
	const keeper = new Map(); // key → page id
	const display = new Map();
	for (const [k, g] of groups) {
		// Publishers: fewest words wins ("Phaidon" over "Phaidon Press"); on a
		// tie the fuller spelling ("Simon & Schuster" over "Simon Schuster").
		const words = (s) => s.split(/\s+/).filter((w) => /\w/.test(w)).length;
		const want = kind.publisher
			? [...new Set([...g.names].map(short))].sort((a, b) => words(a) - words(b) || b.length - a.length)[0]
			: [...g.names].sort((a, b) => b.length - a.length)[0]; // authors: the fullest form
		display.set(k, want);
		const whole = [...g.pages].filter((id) => !name(id).startsWith('"') && !name(id).endsWith('"'));
		const exact = whole.find((id) => clean(name(id)) === want);
		const best = exact ?? whole.sort((a, b) => (uses.get(b) ?? 0) - (uses.get(a) ?? 0))[0];
		if (best) {
			keeper.set(k, best);
			if (clean(name(best)) !== want) plan.renames.push({ kind: kind.prop, id: best, from: name(best), to: want });
		}
	}

	// 4. Rewrite each book's relation to keepers.
	const stillUsed = new Set();
	for (const { b, ids } of bookEntries) {
		if (!ids.length) continue;
		const next = [];
		for (const e of rejoin(ids)) {
			const k = groupKey(e.name, kind.publisher);
			let id = keeper.get(k);
			if (!id && e.from.length > 1) id = 'NEW:' + (kind.publisher ? short(e.name) : clean(e.name));
			id ??= e.from[0];
			if (!next.includes(id)) next.push(id);
		}
		next.forEach((id) => stillUsed.add(id));
		if (next.join() !== ids.join()) {
			plan.books.push({ kind: kind.prop, ds: kind.ds, book: b.id, title: titleOf(b), from: ids.map(name), to: next, toNames: next.map((id) => (id.startsWith('NEW:') ? id.slice(4) + ' (new)' : (plan.renames.find((r) => r.id === id)?.to ?? clean(name(id))))) });
		}
	}

	// 5. Trash pages that were duplicates or split halves and now have no books
	//    and no links anywhere else.
	for (const p of pages) {
		if (stillUsed.has(p.id)) continue;
		const n = titleOf(p);
		const wasPart = n.startsWith('"') || n.endsWith('"') || n === 'Little' || n === 'Brown and Company' || /^\d{8,}$/.test(n) || !groupKey(n, kind.publisher);
		const k = groupKey(n, kind.publisher);
		const wasDup = keeper.has(k) && keeper.get(k) !== p.id;
		const otherLinks = Object.entries(p.properties).some(([key, x]) => x.type === 'relation' && x.relation.length && !/Library of KB|^Books$/.test(key));
		if ((wasPart || wasDup) && !otherLinks) plan.trash.push({ kind: kind.prop, id: p.id, name: n });
		else if (!uses.has(p.id)) plan.keptUnused++;
	}
}

console.log(`RENAME ${plan.renames.length}`);
for (const r of plan.renames) console.log(`  ${r.kind}: "${r.from}" → "${r.to}"`);
console.log(`\nBOOKS ${plan.books.length}`);
for (const b of plan.books) console.log(`  ${b.title} [${b.kind}]: ${b.from.join(' + ')}  →  ${b.toNames.join(' + ')}`);
console.log(`\nTRASH ${plan.trash.length}`);
console.log('  ' + plan.trash.map((t) => `${t.kind}: ${t.name}`).join('\n  '));
console.log(`\n(unused pages that weren't duplicates, left alone: ${plan.keptUnused})`);

if (apply) {
	const created = new Map();
	for (const r of plan.renames) {
		const page = await api('GET', `pages/${r.id}`);
		await api('PATCH', `pages/${r.id}`, { properties: { [titleKey(page)]: { title: [{ text: { content: r.to } }] } } });
	}
	for (const b of plan.books) {
		const ids = [];
		for (const id of b.to) {
			if (!id.startsWith('NEW:')) { ids.push(id); continue; }
			const nm = id.slice(4);
			if (!created.has(nm)) {
				const p = await api('POST', 'pages', { parent: { type: 'data_source_id', data_source_id: b.ds }, properties: { Name: { title: [{ text: { content: nm } }] } } });
				created.set(nm, p.id);
			}
			ids.push(created.get(nm));
		}
		await api('PATCH', `pages/${b.book}`, { properties: { [b.kind]: { relation: ids.map((id) => ({ id })) } } });
	}
	for (const t of plan.trash) await api('PATCH', `pages/${t.id}`, { in_trash: true });
	console.log(`\nApplied: ${plan.renames.length} renamed, ${created.size} created, ${plan.books.length} books updated, ${plan.trash.length} trashed.`);
}
