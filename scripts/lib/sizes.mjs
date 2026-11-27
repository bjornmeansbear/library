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

async function sru(isbn) {
	const url = `https://lx2.loc.gov/sru/lcdb?version=1.1&operation=searchRetrieve&query=bath.isbn=${isbn}&recordSchema=marcxml&maximumRecords=1`;
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

// { pages, heightCm, widthCm } from the Library of Congress, or null.
export async function locRecord(isbn13) {
	for (const isbn of [isbn13, to10(isbn13)].filter(Boolean)) {
		const xml = await sru(isbn);
		const field = xml?.match(/<datafield tag="300"[\s\S]*?<\/datafield>/)?.[0];
		if (!field) continue;
		const sub = (code) => field.match(new RegExp(`<subfield code="${code}">([^<]*)<`))?.[1] ?? '';
		const a = sub('a'), c = sub('c') || field;
		const pages = Math.max(0, ...[...a.matchAll(/(\d+)\s*(?:p\b|pages)/g)].map((m) => Number(m[1]))) || null;
		const d = c.match(/(\d+(?:\.\d+)?)\s*(?:x\s*(\d+(?:\.\d+)?)\s*)?cm/);
		return { pages, heightCm: d ? Number(d[1]) : null, widthCm: d?.[2] ? Number(d[2]) : null };
	}
	return null;
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