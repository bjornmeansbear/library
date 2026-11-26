// Fill empty Pages, Height, Width and Thickness in Notion from Open Library
// and the Library of Congress catalogue, by ISBN.
//
//   npm run sizes                 show what it would write
//   npm run sizes -- --apply      write it
//
// Only fills empty fields, and marks each height's source in "Size from"
// (Open Library / Library of Congress). Calipers beat both: type your
// measurement over the top and set Size from to Measured. Films and albums
// are skipped; their cases are a fixed size.
import fs from 'node:fs';
import path from 'node:path';
import { DS, api, queryAll, text, titleOf } from './lib/notion.mjs';
import { edition, isbn13 } from './lib/openlibrary.mjs';
import { locRecord, sizeProps } from './lib/sizes.mjs';

const root = path.resolve(import.meta.dirname, '..');
const olPath = path.join(root, 'data/openlibrary-editions.json');
const locPath = path.join(root, 'data/loc.json');
const apply = process.argv.includes('--apply');

const olCache = fs.existsSync(olPath) ? JSON.parse(fs.readFileSync(olPath, 'utf8')) : {};
const locCache = fs.existsSync(locPath) ? JSON.parse(fs.readFileSync(locPath, 'utf8')) : {};
const save = () => {
	fs.writeFileSync(olPath, JSON.stringify(olCache, null, '\t') + '\n');
	fs.writeFileSync(locPath, JSON.stringify(locCache, null, '\t') + '\n');
};

const books = await queryAll(DS.books);
const count = { 'Open Library': 0, 'Library of Congress': 0, pages: 0, width: 0, thickness: 0, books: 0 };
let i = 0;
for (const p of books) {
	const pr = p.properties;
	const format = pr['Format']?.select?.name ?? 'Book';
	const isbn = isbn13(text(pr['ISBN-13']) || '');
	if (!isbn || format === 'Film' || format === 'Music') continue;
	const empty = {
		height: pr['Height (mm)']?.number == null,
		width: pr['Width (mm)']?.number == null,
		thickness: pr['Thickness (mm)']?.number == null,
		pages: pr['Pages']?.number == null
	};
	if (!Object.values(empty).some(Boolean)) continue;

	if (!(isbn in olCache)) olCache[isbn] = await edition(isbn);
	const ol = olCache[isbn];
	if (!(isbn in locCache)) locCache[isbn] = await locRecord(isbn);
	const loc = locCache[isbn];
	if (++i % 25 === 0) save();

	const props = sizeProps({ ol, loc, empty });
	if (!Object.keys(props).length) continue;
	count.books++;
	if (props['Size from']) count[props['Size from'].select.name]++;
	if (props['Pages']) count.pages++;
	if (props['Width (mm)']) count.width++;
	if (props['Thickness (mm)']) count.thickness++;
	const show = Object.entries(props).map(([k, v]) => `${k} ${v.number ?? v.select.name}`).join(' · ');
	console.log(`${apply ? '✓' : '○'} ${titleOf(p).slice(0, 50)} · ${show}`);
	if (apply) await api('PATCH', `pages/${p.id}`, { properties: props });
}
save();
console.log(`\n${apply ? 'Wrote' : 'Would write'} ${count.books} books: heights from Open Library ${count['Open Library']}, from the Library of Congress ${count['Library of Congress']}; widths ${count.width}; thicknesses ${count.thickness}; page counts ${count.pages}.`);
if (!apply) console.log('Run `npm run sizes -- --apply` to write it.');
