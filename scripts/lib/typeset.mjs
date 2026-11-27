// Typographer's marks for the ones catalogs type: curly quotes, real
// apostrophes, a one-character ellipsis, and a spaced hyphen as a spaced em
// dash. The same rules as Bjook's smarten(), so the site and the book agree.
// Running it twice changes nothing.
/** @template {string | null | undefined} T @param {T} text @returns {T} */
export function typeset(text) {
	if (!text) return text;
	return /** @type {T} */ (text
		.replace(/\.{3,}/g, '…')
		.replace(/(?<=\w)'(?=\w)/g, '’') // don't, Mary's
		.replace(/'(?=\d0s\b|\d\d\b)/g, '’') // '90s, '71
		.replace(/(^|[\s(\[{—–\-*_“‘])"/g, '$1“')
		.replace(/"/g, '”')
		.replace(/(^|[\s(\[{—–\-*_“‘])'(?=\S)/g, '$1‘')
		.replace(/'/g, '’')
		.replace(/(?<=\S)\s+[-–]\s+(?=\S)/g, ' — '));
}

// For matching what someone types against typeset text: curly marks and
// dashes back to the keys on a keyboard.
export const plain = (/** @type {string} */ text) =>
	text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[—–]/g, '-');
