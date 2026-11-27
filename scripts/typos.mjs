// List likely typos in the catalog, to check by eye and copy into fixes.txt.
// Reads src/lib/data/library.json (so `npm run sync` first for the latest)
// and the computer's own word list; it needs no network and changes nothing.
//
//   npm run typos
//
// What it looks for:
//   - two spellings of one name: "HarperPerennial" and "Harper Perennial",
//     "Steward Brand" and "Stewart Brand"
//   - a capital too many: "LIfe", "SInger"
//   - stray punctuation: "Horrible;s", "fro, Special", doubled spaces
//   - title words that aren't words, one slip from a word the catalog uses
//     elsewhere: "Enviornment" (Environmental), "Sytems" (Systems). Names
//     and foreign words aren't in the dictionary either, so it only suggests
//     words already in the catalog; that keeps the list short.
// It can't catch a name spelled wrong on its only book ("Alvia Toffler"):
// that takes someone who knows the name.
//
// A word that's right where it is (a foreign word, a name) goes in fixes.txt
// as `ok: Natur in Natur und Bauen`: that word, in the book whose title
// starts that way, isn't listed again. The same word in any other title is.
import fs from 'node:fs';

const books = JSON.parse(fs.readFileSync('src/lib/data/library.json', 'utf8')).books;
const DICT = '/usr/share/dict/words';
const dict = fs.existsSync(DICT) ? new Set(fs.readFileSync(DICT, 'utf8').toLowerCase().split('\n')) : null;
const plain = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[‘’]/g, "'");
const out = [];

// Words checked and found right, each in one book: `ok: Natur in Natur und Bauen`.
const fold = (s) => plain(s ?? '').replace(/[“”]/g, '"').toLowerCase().trim();
const oks = fs.existsSync('fixes.txt')
	? fs.readFileSync('fixes.txt', 'utf8').split('\n').map((l) => l.trim().match(/^ok:\s*(.+?)\s+in\s+(.+)$/)).filter(Boolean).map((m) => [fold(m[1]), fold(m[2])])
	: [];
const okay = (word, title) => oks.some(([w, t]) => w === fold(word) && fold(title).startsWith(t));

// Is it a word, allowing for endings the word list leaves out?
const STEMS = [[/ies$/, 'y'], [/ied$/, 'y'], [/es$/, ''], [/s$/, ''], [/ed$/, ''], [/ed$/, 'e'], [/d$/, ''], [/ing$/, ''], [/ing$/, 'e'], [/men$/, 'man'], [/ly$/, ''], [/er$/, ''], [/ers$/, '']];
const isWord = (w) => dict.has(w) || STEMS.some(([end, put]) => end.test(w) && dict.has(w.replace(end, put)));
const WORD = /(?<![A-Za-z'’])[A-Za-z]{5,}(?![A-Za-z'’])/g;
// The catalog's own vocabulary: the words its titles use, that are words.
const vocab = new Set();
if (dict) for (const b of books) for (const w of plain(`${b.title} ${b.subtitle ?? ''}`).match(WORD) ?? []) if (isWord(w.toLowerCase())) vocab.add(w.toLowerCase());
// Name words: never typos of a dictionary word, as far as this can tell.
const nameWords = new Set(books.flatMap((b) => [...b.authors, ...b.publishers]).flatMap((n) => plain(n).toLowerCase().match(/[a-z]+/g) ?? []));

// One slip apart: a letter added, dropped, changed, or two swapped.
function oneSlip(a, b) {
	if (Math.abs(a.length - b.length) > 1 || a === b) return false;
	if (a.length === b.length) {
		const diff = [...a].map((c, i) => (c !== b[i] ? i : -1)).filter((i) => i >= 0);
		return diff.length === 1 || (diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]]);
	}
	const [long, short] = a.length > b.length ? [a, b] : [b, a];
	for (let i = 0; i < long.length; i++) if (long.slice(0, i) + long.slice(i + 1) === short) return true;
	return false;
}

// Two spellings of one name
for (const [field, kind] of [['authors', 'person'], ['publishers', 'publisher']]) {
	const count = new Map();
	for (const b of books) for (const n of b[field] ?? []) count.set(n, (count.get(n) ?? 0) + 1);
	const names = [...count.keys()];
	const squash = (n) => plain(n).toLowerCase().replace(/\b\w\b\.?/g, '').replace(/[^a-z]/g, '');
	const seen = new Set();
	for (const a of names) {
		for (const b of names) {
			if (a >= b) continue;
			const [x, y] = [squash(a), squash(b)];
			if (x.length < 6 || !(x === y || oneSlip(x, y))) continue;
			if (seen.has(a + b)) continue;
			seen.add(a + b);
			// the one on fewer books is probably the slip
			const [wrong, right] = count.get(a) < count.get(b) ? [a, b] : [b, a];
			out.push([`${kind}: ${wrong} → ${right}`, `"${wrong}" (${count.get(wrong)}) looks like "${right}" (${count.get(right)}); check which is right`]);
		}
	}
}

for (const b of books) {
	const where = (b.title.length > 50 ? b.title.slice(0, 47) + '…' : b.title);
	for (const [field, value] of [['title', b.title], ['subtitle', b.subtitle], ...b.authors.map((a) => ['person', a])]) {
		if (!value) continue;
		// A capital too many
		for (const w of value.match(/\b[A-Z]{2}[a-z]+\b/g) ?? []) {
			if (okay(w, b.title)) continue;
			const fixed = w[0] + w.slice(1).toLowerCase();
			out.push([field === 'person' ? `person: ${value} → ${value.replace(w, fixed)}` : `title: ${w} → ${fixed}`, `in ${field === 'person' ? `an author of ${where}` : where}`]);
		}
		// Stray punctuation
		for (const m of value.match(/\w;\w|\w ,|\s{2,}|\( | \)/g) ?? []) {
			if (okay(m.trim(), b.title)) continue;
			out.push([`title: ${m.trim()} → ?`, `odd punctuation "${m}" in ${where}`]);
		}
		// One slip from a dictionary word
		if (dict && field !== 'person') {
			for (const w of plain(value).match(WORD) ?? []) {
				const lw = w.toLowerCase();
				if (isWord(lw) || nameWords.has(lw) || okay(w, b.title)) continue;
				const near = [...vocab].find((d) => d[0] === lw[0] && oneSlip(lw, d));
				if (near) out.push([`title: ${w} → ${w[0] === w[0].toUpperCase() ? near[0].toUpperCase() + near.slice(1) : near}`, `maybe; in ${where}`]);
			}
		}
	}
}

const unique = [...new Map(out.map(([fix, why]) => [fix, why])).entries()];
if (!unique.length) console.log(`Nothing looks wrong.${oks.length ? ` (${oks.length} words marked ok in fixes.txt.)` : ''}`);
else {
	console.log(`${unique.length} to check. Copy the right ones into fixes.txt, then \`npm run fix\`;`);
	console.log(`for a word that's right where it is, add \`ok: Word in Title\` to fixes.txt.\n`);
	for (const [fix, why] of unique) console.log(`${fix.padEnd(52)}  # ${why}`);
}
