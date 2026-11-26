// Open Library lookups by ISBN: the edition (title, subtitle, publisher,
// year, pages, size, Library of Congress call number) and its authors.
// Free, no key; we identify ourselves and keep to about 3 requests a second.
const UA = { 'User-Agent': 'library-site-build (static site generator)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path) {
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			const res = await fetch(`https://openlibrary.org${path}`, { headers: UA, redirect: 'follow' });
			await sleep(350);
			if (res.status === 404) return null;
			if (res.ok) return await res.json();
		} catch {
			await sleep(1000);
		}
	}
	return null;
}

const authorNames = new Map();
async function authorName(key) {
	if (!authorNames.has(key)) authorNames.set(key, (await get(`${key}.json`))?.name ?? null);
	return authorNames.get(key);
}

// Everything Notion has a field for, or null when Open Library doesn't
// know the ISBN.
export async function edition(isbn) {
	const e = await get(`/isbn/${isbn}.json`);
	if (!e) return null;
	let authorKeys = (e.authors ?? []).map((a) => a.key);
	if (!authorKeys.length && e.works?.[0]?.key) {
		const work = await get(`${e.works[0].key}.json`);
		authorKeys = (work?.authors ?? []).map((a) => a.author?.key).filter(Boolean);
	}
	const authors = [];
	for (const k of authorKeys.slice(0, 6)) {
		const n = await authorName(k);
		if (n) authors.push(n);
	}
	const year = String(e.publish_date ?? '').match(/\b(1[5-9]\d\d|20\d\d)\b/)?.[1] ?? null;
	return {
		key: e.key,
		title: e.title ?? null,
		subtitle: e.subtitle ?? null,
		authors,
		publishers: e.publishers ?? [],
		year,
		pages: e.number_of_pages ?? null,
		dimensions: e.physical_dimensions ?? null,
		lcc: e.lc_classifications?.[0] ?? null
	};
}

// ISBN check digits, and 10 → 13.
export function valid13(s) {
	if (!/^\d{13}$/.test(s)) return false;
	let t = 0;
	for (let i = 0; i < 13; i++) t += Number(s[i]) * (i % 2 ? 3 : 1);
	return t % 10 === 0;
}
export function valid10(s) {
	if (!/^\d{9}[\dX]$/.test(s)) return false;
	let t = 0;
	for (let i = 0; i < 10; i++) t += (s[i] === 'X' ? 10 : Number(s[i])) * (10 - i);
	return t % 11 === 0;
}
export function to13(s10) {
	const c = '978' + s10.slice(0, 9);
	let t = 0;
	for (let i = 0; i < 12; i++) t += Number(c[i]) * (i % 2 ? 3 : 1);
	return c + ((10 - (t % 10)) % 10);
}
// Whatever was typed or scanned → a checked ISBN-13, or null.
export function isbn13(input) {
	const s = String(input).toUpperCase().replace(/[^\dX]/g, '');
	if (valid13(s)) return s;
	if (valid10(s)) return to13(s);
	return null;
}
