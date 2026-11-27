// @ts-nocheck: a Node script, shared with the /scan Worker; not type-checked
// Book sizes and page counts from free catalogues, as Notion fields.
//
// Open Library sometimes records all three dimensions ("8.5 x 5.5 x 0.54
// inches"). The Library of Congress catalogue records nearly every US book's
// height, rounded UP to the next centimetre, and its pages, in the MARC 300
// field ("xix, 289 p. : ill. ; 24 cm"). Neither knows thickness reliably
// except Open Library's three-number dimensions; the site estimates the rest
// from the page count.
const UA = { 'User-Agent': 'library-site-build (static site generator)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function to10(isbn13) {
	if (!isbn13.startsWith('978')) return null;
	const core = isbn13.slice(3, 12);
	let t = 0;
	for (let i = 0; i < 9; i++) t += Number(core[i]) * (10 - i);
	const c = (11 - (t % 11)) % 11;
	return core + (c === 10 ? 'X' : String(c));
}

async function sru(query, max = 1) {
	const url = `https://lx2.loc.gov/sru/lcdb?version=1.1&operation=searchRetrieve&query=${query}&recordSchema=marcxml&maximumRecords=${max}`;
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			const res = await fetch(url, { headers: UA });
			await sleep(700);
			if (res.ok) return await res.text();
		} catch {
			await sleep(2000);
		}
	}
	return null;
}

// One Library of Congress catalogue record (MARC XML) as plain fields:
// { pages, heightCm, widthCm } from its physical description (MARC 300),
// and { title, subtitle, author, publisher, year } (MARC 245, 100, 264/260).
// Older records often name the author only in the title's statement of
// responsibility ("by Hamilton Wright Mabie"), so that's the fallback.
export function marcBook(xml) {
	const field = (tag) => xml.match(new RegExp(`<datafield tag="${tag}"[\\s\\S]*?</datafield>`))?.[0] ?? '';
	const sub = (f, code) => decode(f.match(new RegExp(`<subfield code="${code}">([^<]*)<`))?.[1] ?? '').trim();
	// Catalogue punctuation hangs off the end of each part: "Title /", "Publisher,".
	const tidy = (t) => t.replace(/\s*[\/:;,.]\s*$/, '').replace(/^\[|\]$/g, '').trim() || null;
	const physical = field('300');
	const a = sub(physical, 'a'), c = sub(physical, 'c') || physical;
	const pages = Math.max(0, ...[...a.matchAll(/(\d+)\s*(?:p\b|pages)/g)].map((m) => Number(m[1]))) || null;
	const d = c.match(/(\d+(?:\.\d+)?)\s*(?:x\s*(\d+(?:\.\d+)?)\s*)?cm/);
	const imprint = field('264') || field('260');
	const title = field('245');
	const name = tidy(sub(field('100'), 'a'));
	const byLine = sub(title, 'c').match(/\bby\s+([^;,.]+?)(?:\s*[;,.]|$)/i)?.[1]?.trim();
	return {
		pages,
		heightCm: d ? Number(d[1]) : null,
		widthCm: d?.[2] ? Number(d[2]) : null,
		title: tidy(sub(title, 'a')),
		subtitle: tidy(sub(title, 'b')),
		// "Lupton, Ellen" → "Ellen Lupton"
		author: name ? name.replace(/^([^,]+),\s*(.+)$/, '$2 $1') : byLine || null,
		publisher: tidy(sub(imprint, 'b')),
		year: sub(imprint, 'c').match(/\b(1[5-9]\d\d|20\d\d)\b/)?.[1] ?? null
	};
}
const decode = (t) => t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");

// What the Library of Congress knows about one ISBN, or null.
export async function locRecord(isbn13) {
	for (const isbn of [isbn13, to10(isbn13)].filter(Boolean)) {
		const xml = await sru(`bath.isbn=${isbn}`);
		if (xml?.includes('<datafield')) return marcBook(xml);
	}
	return null;
}

// Library of Congress records matching some words (title, author, both),
// for books with no ISBN. Each is one edition: its own publisher and year.
export async function locSearch(words, max = 8) {
	const xml = await sru(encodeURIComponent(words.replace(/"/g, ' ')), max);
	return (xml ?? '').split('<zs:record>').slice(1).map(marcBook).filter((b) => b.title);
}

// Open Library's "8.5 x 5.5 x 0.54 inches" → [height, width, thickness] in mm,
// largest first. Null when it isn't a believable book.
export function olMillimetres(dimensions) {
	if (!dimensions) return null;
	const nums = (dimensions.match(/[\d.]+/g) ?? []).map(Number).filter((n) => n > 0);
	if (nums.length < 2) return null;
	const k = /cent/i.test(dimensions) ? 10 : /mill/i.test(dimensions) ? 1 : 25.4;
	const [h, w, t] = nums.map((n) => Math.round(n * k)).sort((x, y) => y - x);
	if (h < 80 || h > 500 || (t != null && (t < 1 || t > 120))) return null;
	return [h, w, t ?? null];
}

// The Notion properties to set, given what's empty now. Never touches a
// filled field; says where a height came from in "Size from".
export function sizeProps({ ol, loc, empty }) {
	const props = {};
	const mm = olMillimetres(ol?.dimensions);
	if (empty.height) {
		if (mm) {
			props['Height (mm)'] = { number: mm[0] };
			if (empty.width && mm[1]) props['Width (mm)'] = { number: mm[1] };
			if (empty.thickness && mm[2]) props['Thickness (mm)'] = { number: mm[2] };
			props['Size from'] = { select: { name: 'Open Library' } };
		} else if (loc?.heightCm && loc.heightCm >= 8 && loc.heightCm <= 50) {
			props['Height (mm)'] = { number: Math.round(loc.heightCm * 10) };
			if (empty.width && loc.widthCm) props['Width (mm)'] = { number: Math.round(loc.widthCm * 10) };
			props['Size from'] = { select: { name: 'Library of Congress' } };
		}
	}
	const pages = ol?.pages || loc?.pages;
	if (empty.pages && pages && pages < 5000) props['Pages'] = { number: pages };
	return props;
}