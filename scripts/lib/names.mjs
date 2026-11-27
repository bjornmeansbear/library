// @ts-nocheck: a Node script, shared with the /scan Worker; not type-checked
// Name matching, shared by the scripts and the site's /scan page. No Node
// APIs here, so it runs in the Worker too.
// Names, normalized for matching: case, punctuation, accents and (for
// publishers) legal suffixes and generic words don't count. The same rule
// merge-names.mjs used to clean the databases up.
export function nameKey(s, publisher = false) {
	let k = s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/["“”]/g, '').toLowerCase().replace(/[.,&'’]/g, ' ');
	if (publisher) k = k.replace(/\b(inc|ltd|llc|limited|press|publishers?|publishing|publications?|books?|the|company|co)\b/g, ' ');
	return k.replace(/\s+/g, ' ').trim();
}
// "Phaidon Press Limited" → "Phaidon Press"; legal suffixes only.
export function shortPublisher(s) {
	let t = s.replace(/\s+/g, ' ').trim();
	// Library catalogs invert some names: "Norton & Company, W. W." → "W. W. Norton & Company".
	t = t.replace(/^(.+?),\s*((?:[A-Z]\.\s*)+)$/, (_, rest, initials) => `${initials.trim()} ${rest}`);
	const LEGAL = /,?\s*\b(inc|ltd|llc|limited)\b\.?(?=$|,)/i;
	while (LEGAL.test(t)) t = t.replace(LEGAL, '').trim();
	return t.replace(/,$/, '');
}