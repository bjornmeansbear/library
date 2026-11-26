// Suggest shelf tags for every book, from what Notion and Open Library
// already know.
//
//   npm run tags                      write TAG-PLAN.md (nothing changes in Notion)
//   npm run tags -- --apply           add the SURE tags
//   npm run tags -- --apply --maybe 3,7,12   …plus those numbered maybes
//   npm run tags -- --apply --maybe all      …plus every maybe
//
// Signals: the Library of Congress call number (Z250 → Typography, NA →
// Architecture), Open Library's subject headings, words in the title and
// subtitle, a few authors, and the old Sustainabilitist list. A tag is
// SURE when a signal names the subject outright, MAYBE when it only hints.
// Tags that carry your own argument (Pragmatic Utopian, Climate Designer)
// are only ever maybes. Only adds; never removes a tag.
import fs from 'node:fs';
import path from 'node:path';
import { DS, api, queryAll, text, titleOf, nameKey } from './lib/notion.mjs';
import { isbn13, subjects } from './lib/openlibrary.mjs';

const root = path.resolve(import.meta.dirname, '..');
const planJson = path.join(root, 'data/tag-plan.json');
const planMd = path.join(root, 'TAG-PLAN.md');
const cachePath = path.join(root, 'data/openlibrary-subjects.json');
const sustJson = path.join(root, 'data/sustainabilitist-matched.json');

// The shelves, in the order the plan lists them. `create` ones don't exist
// yet and are made on --apply only if a book gets them.
const SHELVES = [
	'Sustainabilitist', 'Climate Designer', 'Circular Economy', 'Pragmatic Utopian',
	'Typography', 'Graphic Design', 'Publication Design', 'Color Design', 'Visual Fundamentals',
	'Product Design', 'Architecture', 'Bauhaus', 'Black Mountain', 'Modernist', 'Aesthetics',
	'Pedagogy', 'Open Source', 'The Commons', 'Intellectual Property'
];

// [class letters, from, to] on the call number.
const lccIn = (lcc, cls, from = 0, to = 1e9) => {
	const m = lcc.match(/^([A-Z]{1,3})\s*(\d+(?:\.\d+)?)/);
	return !!m && m[1] === cls && Number(m[2]) >= from && Number(m[2]) < to;
};
const UTOPIANS = /stewart brand|buckminster fuller|bruce mau|alex steffen|papanek|bruce sterling|john thackara|ezio manzini|mcdonough|braungart|tony fry|dunne|raby|kevin kelly/i;

// Each rule: [confidence, reason, test(book)]. b.t = title + subtitle,
// b.s = subject headings joined, b.lcc, b.authors.
const RULES = {
	Sustainabilitist: [
		['sure', 'on the old Sustainabilitist list', (b) => b.sust],
		['maybe', 'subjects: sustainability / environment', (b) => /sustainab|environmental (protection|policy|ethics|economics)|environmentalism|ecolog|green (design|products|marketing)/.test(b.s)],
		['maybe', 'call number GE / HC79.E5 (environment)', (b) => lccIn(b.lcc, 'GE') || /^HC79\.?\s*E5/.test(b.lcc)],
		['maybe', 'title: sustainab / ecolog / environment', (b) => /sustainab|ecolog|environment/.test(b.t)]
	],
	'Climate Designer': [
		['maybe', 'title or subjects: climate / warming / carbon', (b) => /climat|global warming|greenhouse|carbon/.test(b.t + ' ' + b.s)]
	],
	'Circular Economy': [
		['sure', 'title: circular / cradle to cradle / upcycle', (b) => /circular economy|cradle to cradle|upcycl/.test(b.t)],
		['maybe', 'subjects: recycling / waste / product life cycle', (b) => /recycl|refuse and refuse disposal|waste|product life cycle|reuse|repair/.test(b.s)],
		['maybe', 'title: waste / reuse / repair / durable', (b) => /\bwaste|recycl|reus|repair|durab|eternally|life ?cycle|throwaway/.test(b.t)]
	],
	'Pragmatic Utopian': [
		['maybe', 'author', (b) => UTOPIANS.test(b.authors)],
		['maybe', 'title: utopia / future / world-changing', (b) => /utopi|\bfuture|worldchanging|whole earth|massive change|tomorrow/.test(b.t)]
	],
	Typography: [
		['sure', 'call number Z250–Z254 (type, printing)', (b) => lccIn(b.lcc, 'Z', 250, 254)],
		['sure', 'subjects: typography / type / lettering', (b) => /typograph|type and type-founding|lettering|alphabets|type design/.test(b.s)],
		['sure', 'title: type / typography / lettering / font', (b) => /typograph|\btype\b|typeface|letter(ing|form)|\bfonts?\b|alphabet/.test(b.t)]
	],
	'Graphic Design': [
		['sure', 'call number NC997–NC1003 (commercial art)', (b) => lccIn(b.lcc, 'NC', 997, 1004)],
		['sure', 'subjects: graphic design / commercial art', (b) => /graphic design|commercial art|graphic arts/.test(b.s)],
		['sure', 'title: graphic design', (b) => /graphic design/.test(b.t)]
	],
	'Publication Design': [
		['sure', 'call number Z116 / Z246 (book design)', (b) => /^Z\s*(116|246)\b/.test(b.lcc)],
		['sure', 'subjects: book / magazine / layout design', (b) => /book design|magazine design|layout \(printing\)|publication design|editorial design/.test(b.s)],
		['maybe', 'title: book / publication / magazine / zine', (b) => /book design|publication|magazine|editorial|\bzines?\b|publishing/.test(b.t)]
	],
	'Color Design': [
		['sure', 'title: colour', (b) => /\bcolou?rs?\b/.test(b.t)],
		['sure', 'subjects: colour', (b) => /(^|; )colou?r( in| theory|$|;)/.test(b.s)],
		['sure', 'call number ND1486–ND1500 / QC495 (colour)', (b) => lccIn(b.lcc, 'ND', 1486, 1500) || lccIn(b.lcc, 'QC', 494, 497)]
	],
	'Visual Fundamentals': [
		['sure', 'call number N7430–N7433 (composition)', (b) => lccIn(b.lcc, 'N', 7430, 7434)],
		['maybe', 'call number NK1510 (design theory)', (b) => lccIn(b.lcc, 'NK', 1505, 1536)],
		['maybe', 'title: principles / basics / fundamentals / visual grammar', (b) => /principles of|basics|fundamental|visual (grammar|language|literacy|thinking)|point and line|two-dimensional|three-dimensional|\bform\b/.test(b.t)]
	],
	'Product Design': [
		['sure', 'call number TS171 (industrial design)', (b) => lccIn(b.lcc, 'TS', 171, 172)],
		['sure', 'subjects: industrial / product design', (b) => /industrial design|design, industrial|product design/.test(b.s)],
		['maybe', 'title: products / objects / things', (b) => /product|objects?\b|everyday things|useful things|\bthings\b/.test(b.t)]
	],
	Architecture: [
		['sure', 'call number NA (architecture)', (b) => lccIn(b.lcc, 'NA')],
		['sure', 'subjects: architecture', (b) => /(^|; )(architecture|architectural|vernacular architecture|sustainable architecture)/.test(b.s)],
		['maybe', 'title: architecture / building / cities', (b) => /architect|\bbuilding|\bcities\b|\burban|\bhouse\b/.test(b.t)]
	],
	Bauhaus: [['sure', 'title or subjects: Bauhaus', (b) => /bauhaus/.test(b.t + ' ' + b.s)]],
	'Black Mountain': [['sure', 'title or subjects: Black Mountain', (b) => /black mountain/.test(b.t + ' ' + b.s)]],
	Modernist: [
		['maybe', 'subjects: modernism', (b) => /modernism/.test(b.s)],
		['maybe', 'title: modern', (b) => /\bmodern(ism|ist)?\b/.test(b.t)]
	],
	Aesthetics: [
		['sure', 'call number BH (aesthetics)', (b) => lccIn(b.lcc, 'BH')],
		['sure', 'subjects: aesthetics', (b) => /(^|; )aesthetics/.test(b.s)],
		['maybe', 'title: aesthetic / beauty', (b) => /aesthetic|beauty|\btaste\b/.test(b.t)]
	],
	Pedagogy: [
		['sure', 'call number LB (education)', (b) => lccIn(b.lcc, 'LB')],
		['sure', 'subjects: study and teaching', (b) => /study and teaching|design education|art education/.test(b.s)],
		['maybe', 'title: teaching / education / school', (b) => /teach|pedagog|educat|curricul|\bschool|lesson|course\b/.test(b.t)]
	],
	'Open Source': [['sure', 'title or subjects: open source / free software', (b) => /open source|free software|linux|copyleft/.test(b.t + ' ' + b.s)]],
	'The Commons': [
		['sure', 'title or subjects: commons', (b) => /\bcommons\b/.test(b.t + ' ' + b.s)],
		['maybe', 'title or subjects: sharing / public domain / peer production', (b) => /sharing|public domain|peer production|wikipedia|gift economy/.test(b.t + ' ' + b.s)]
	],
	'Intellectual Property': [
		['sure', 'title or subjects: copyright / IP / patents / fair use', (b) => /copyright|intellectual property|patent|trademark|fair use/.test(b.t + ' ' + b.s)],
		['sure', 'call number K1401–K1599 / KF2971–KF3192 (IP law)', (b) => lccIn(b.lcc, 'K', 1401, 1600) || lccIn(b.lcc, 'KF', 2971, 3193)]
	]
};

const args = process.argv.slice(2);
if (args.includes('--apply')) await applyPlan();
else await makePlan();

async function tagIndex(books) {
	// Several tags share a name (two "Modernist"s); use the one books use most.
	const use = new Map();
	for (const p of books) for (const r of p.properties['🏷️ Tags']?.relation ?? []) use.set(r.id, (use.get(r.id) ?? 0) + 1);
	const byName = new Map();
	for (const t of await queryAll(DS.tags)) {
		const k = nameKey(titleOf(t));
		const prev = byName.get(k);
		if (!prev || (use.get(t.id) ?? 0) > (use.get(prev.id) ?? 0)) byName.set(k, { id: t.id, name: titleOf(t) });
	}
	return byName;
}

async function makePlan() {
	const cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf8')) : {};
	const sust = new Set(fs.existsSync(sustJson) ? JSON.parse(fs.readFileSync(sustJson, 'utf8')).map((m) => m.id) : []);
	const books = await queryAll(DS.books);
	const tags = await tagIndex(books);
	const people = new Map((await queryAll(DS.people)).map((p) => [p.id, titleOf(p)]));
	const tagName = new Map([...tags.values()].map((t) => [t.id, t.name]));
	const allTags = new Map((await queryAll(DS.tags)).map((t) => [t.id, titleOf(t)]));

	const plan = Object.fromEntries(SHELVES.map((s) => [s, { tag: s, id: tags.get(nameKey(s))?.id ?? null, sure: [], maybe: [] }]));
	let n = 0;
	for (const p of books) {
		const pr = p.properties;
		const isbn = isbn13(text(pr['ISBN-13']) || '');
		if (isbn && !(isbn in cache)) cache[isbn] = await subjects(isbn);
		const has = new Set((pr['🏷️ Tags']?.relation ?? []).map((r) => nameKey(allTags.get(r.id) ?? tagName.get(r.id) ?? '')));
		const b = {
			t: `${titleOf(p)} ${text(pr['Subtitle'])}`.toLowerCase(),
			s: (isbn ? cache[isbn] : []).join('; ').toLowerCase(),
			lcc: text(pr['LOC Call Number']).toUpperCase(),
			authors: (pr['Author']?.relation ?? []).map((r) => people.get(r.id) ?? '').join(', '),
			sust: sust.has(p.id.replaceAll('-', ''))
		};
		for (const shelf of SHELVES) {
			if (has.has(nameKey(shelf))) continue;
			const hits = RULES[shelf].filter(([, , test]) => test(b));
			if (!hits.length) continue;
			const sure = hits.some(([c]) => c === 'sure');
			const row = { id: p.id, title: titleOf(p), url: p.url, why: hits.filter(([c]) => c === (sure ? 'sure' : 'maybe')).map(([, why]) => why).join('; ') };
			if (sure) plan[shelf].sure.push(row);
			else plan[shelf].maybe.push({ n: ++n, ...row });
		}
	}
	fs.writeFileSync(cachePath, JSON.stringify(cache, null, '\t') + '\n');
	const shelves = Object.values(plan);
	fs.writeFileSync(planJson, JSON.stringify(shelves, null, '\t') + '\n');

	const sureCount = shelves.reduce((a, s) => a + s.sure.length, 0);
	const maybeCount = shelves.reduce((a, s) => a + s.maybe.length, 0);
	const link = (r) => `[${r.title}](${r.url})`;
	const section = (s) => `## ${s.tag}${s.id ? '' : ' (new tag)'}

${s.sure.length ? `**Sure (${s.sure.length})**\n\n${s.sure.map((r) => `- ${link(r)} · ${r.why}`).join('\n')}\n` : '_Nothing sure._\n'}
${s.maybe.length ? `**Maybe (${s.maybe.length})**\n\n${s.maybe.map((r) => `- **m${r.n}** ${link(r)} · ${r.why}`).join('\n')}\n` : ''}`;
	fs.writeFileSync(planMd, `# Tag plan

Generated ${new Date().toISOString().slice(0, 10)} by \`npm run tags\`. Nothing has been written to Notion yet.

**${sureCount} sure** tags and **${maybeCount} maybes** across ${shelves.filter((s) => s.sure.length + s.maybe.length).length} shelves. Books that already have a tag aren't listed for it. ${shelves.filter((s) => !s.id).map((s) => s.tag).join(' and ')} would be new tags.

Sure: a call number or subject heading names the subject, or the title says it outright. Maybe: a hint only. Tags that are your own argument (Pragmatic Utopian, Climate Designer) are only ever maybes.

**To write it**, tell Claude one of:

- "apply the sure tags"
- "apply the sure tags and maybes m3, m7, m12" (or "and all the Typography maybes")
- or name sure ones to leave out first

The 35 new Sustainabilitist books aren't in Notion yet; they get their Sustainabilitist tag on import, and the rest on a rerun after.

${shelves.map(section).join('\n')}`);
	console.log(`${sureCount} sure, ${maybeCount} maybe → TAG-PLAN.md`);
	for (const s of shelves) console.log(`  ${s.tag}: ${s.sure.length} sure, ${s.maybe.length} maybe`);
}

async function applyPlan() {
	const shelves = JSON.parse(fs.readFileSync(planJson, 'utf8'));
	const mi = args.indexOf('--maybe');
	const pick = mi >= 0 ? args[mi + 1] : '';
	const maybes = pick === 'all' ? null : new Set(pick.split(',').map((x) => Number(x.replace(/^m/, ''))).filter(Boolean));
	const books = await queryAll(DS.books);
	const tags = await tagIndex(books);

	// Collect per book, so each page is written once.
	const add = new Map();
	for (const s of shelves) {
		const rows = [...s.sure, ...s.maybe.filter((r) => (maybes === null ? true : maybes.has(r.n)))];
		if (!rows.length) continue;
		let id = s.id ?? tags.get(nameKey(s.tag))?.id;
		if (!id) {
			id = (await api('POST', 'pages', { parent: { type: 'data_source_id', data_source_id: DS.tags }, properties: { Name: { title: [{ text: { content: s.tag } }] } } })).id;
			console.log(`+ new tag ${s.tag}`);
		}
		for (const r of rows) add.set(r.id, [...(add.get(r.id) ?? []), id]);
	}
	let n = 0;
	for (const [bookId, ids] of add) {
		const page = await api('GET', `pages/${bookId}`);
		const now = (page.properties['🏷️ Tags']?.relation ?? []).map((r) => r.id);
		const next = [...new Set([...now, ...ids])];
		if (next.length === now.length) continue;
		await api('PATCH', `pages/${bookId}`, { properties: { '🏷️ Tags': { relation: next.map((id) => ({ id })) } } });
		n++;
	}
	console.log(`Tagged ${n} books. Run \`npm run sync\` and push, or wait for the nightly sync.`);
}
