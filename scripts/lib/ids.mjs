// @ts-nocheck: shared by the Node scripts and the /scan Worker
// The Notion data sources the library reads and writes: one place for both
// the scripts and the site's /scan page.
export const DS = {
	books: 'f4d45ea0-fcaf-44cb-a488-5a3e6ba3537f',
	people: 'dcabd07d-b2e1-4af3-a0cc-51ed47cc1678',
	publishers: '9027a079-5e5d-44c5-a5aa-a5b3abfd441a',
	tags: 'e6a290b7-0f2d-4245-b942-d6425c840f73',
	shelves: '14a55aa2-8d71-8172-bfc8-000be9afab98',
	rooms: '14a55aa2-8d71-81ef-be81-000b5ae47302'
};

// A shelf's room: the Rooms page(s) it links to through "🛖 Room-Grid view",
// by name; the older "Room" choice if it links to none. `roomNames` maps a
// Rooms page id to its name.
export function roomOf(shelf, roomNames) {
	const linked = (shelf.properties['🛖 Room-Grid view']?.relation ?? []).map((r) => roomNames.get(r.id)).filter(Boolean);
	return linked.join(' / ') || shelf.properties['Room']?.select?.name || '';
}
