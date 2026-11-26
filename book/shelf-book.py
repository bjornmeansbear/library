# Mockup: "Library", the library as a half-letter book, planned by spread.
# Spines at 1/4 scale, two shelves per page, shelf lines at the same height on
# every page and running off every edge. Each spine is set in its book's face
# from the website, so the book is also a specimen of thirteen open-source
# typefaces. Books about the commons are black spines with reversed titles.
# An A-Z index and a colophon (the type, and where to get it) at the back.
import json, html, re
LIB = '/Users/kbjornard/Code/library'
data = json.load(open(f'{LIB}/src/lib/data/library.json'))
books = data['books']
esc = html.escape
PT = 72
PAGE_W = 5.5 * PT
import os
# MODE=wall: two shelves per spread at 1/4 size. MODE=endless: one shelf that
# runs through the whole book at 0.4 size, continuing from spread to spread.
MODE = os.environ.get('MODE', 'wall')
SCALE = 0.4 if MODE == 'endless' else 0.25
OUTER, FOLD = 0.2 * PT, 0.3 * PT
SHELVES_Y = [7.9 * PT] if MODE == 'endless' else [4.05 * PT, 8.05 * PT]
MINW = 6.5
SIZE = 4.5 * SCALE / 0.25                    # spine type size, pt (grows with the scale)
COMMONS = {'Open Source', 'The Commons', 'A New Design Commons', 'Public Domain', 'Copyright', 'Intellectual Property'}

# The faces, read from the website's CSS, with where to get each one.
FACES = {}
for m in re.finditer(r"\.face-([\w-]+) \{ --spine-font: '([^']+)'[^;]*; --spine-weight: (\d+);(?: --spine-scale: ([\d.]+);)?", open(f'{LIB}/src/routes/layout.css').read()):
    FACES[m[1]] = {'family': m[2], 'weight': int(m[3]), 'scale': float(m[4] or 1)}
ABOUT = {  # designer, where to get it
    'work-sans': ('Wei Huang', 'fonts.google.com/specimen/Work+Sans'),
    'libre-franklin': ('Impallari Type', 'fonts.google.com/specimen/Libre+Franklin'),
    'gentium': ('SIL International', 'software.sil.org/gentium'),
    'eb-garamond': ('Georg Duffner and Octavio Pardo', 'fonts.google.com/specimen/EB+Garamond'),
    'crimson-pro': ('Jacques Le Bailly', 'fonts.google.com/specimen/Crimson+Pro'),
    'newsreader': ('Production Type', 'fonts.google.com/specimen/Newsreader'),
    'plex-mono': ('Mike Abbink and Bold Monday, for IBM', 'github.com/IBM/plex'),
    'league-gothic': ('The League of Moveable Type', 'theleagueofmoveabletype.com/league-gothic'),
    'young-serif': ('Bastien Sozeau', 'fonts.google.com/specimen/Young+Serif'),
    'space-mono': ('Colophon Foundry', 'fonts.google.com/specimen/Space+Mono'),
    'bricolage': ('Mathieu Triay', 'fonts.google.com/specimen/Bricolage+Grotesque'),
    'fraunces': ('Undercase Type', 'fonts.google.com/specimen/Fraunces'),
    'basteleur': ('Keussel, published by Velvetyne', 'velvetyne.fr/fonts/basteleur'),
}
PKG = {'work-sans': 'work-sans', 'libre-franklin': 'libre-franklin', 'gentium': 'gentium-book-plus', 'eb-garamond': 'eb-garamond',
       'crimson-pro': 'crimson-pro', 'newsreader': 'newsreader', 'plex-mono': 'ibm-plex-mono', 'league-gothic': 'league-gothic',
       'young-serif': 'young-serif', 'space-mono': 'space-mono', 'bricolage': 'bricolage-grotesque', 'fraunces': 'fraunces'}
fontcss = []
for key, f in FACES.items():
    if key == 'basteleur':
        fontcss.append(f"@font-face {{ font-family: 'Basteleur'; font-weight: 700; src: url('file://{LIB}/static/fonts/Basteleur-Bold.woff2'); }}")
        continue
    d = f'{LIB}/node_modules/@fontsource/{PKG[key]}'
    css = open(f"{d}/{f['weight']}.css").read()
    fontcss.append(re.sub(r'url\(\./files/', f'url(file://{d}/files/', css))

def width(b): return max(MINW, b['thickness'] * SCALE * PT)
def fit(title, room, per_letter):
    fits = lambda t: len(t) * per_letter <= room
    if fits(title): return title
    main = title.split(':')[0].strip()
    if fits(main): return main
    out = ''
    for w in main.split():
        if not fits((out + ' ' + w).strip() + '…'): break
        out = (out + ' ' + w).strip()
    return (out or main[: max(1, int(room / per_letter) - 1)]).rstrip(' ,;–-') + '…'

shelves, row, used = [], [], 0
usable = 2 * PAGE_W - 2 * OUTER          # one shelf runs the width of the spread, through the fold
for b in books:
    w = width(b)
    if row and used + w > usable:
        shelves.append(row); row, used = [], 0
    row.append(b); used += w
if row: shelves.append(row)

page_of = {}
def spine(b, x, y, page):
    page_of.setdefault(b['slug'], page)
    w, h = width(b), b['height'] * SCALE * PT
    f = FACES[b['face']]
    size = SIZE * f['scale']
    mono = 'Mono' in f['family']
    per_letter = size * (0.6 if mono else 0.5)
    author = b['authors'][0].split()[-1] if b['authors'] else ''
    room = h - 8 - len(author) * per_letter
    commons = 'commons' if COMMONS & set(b['tags']) else ''
    return (f'<div class="spine {commons}" style="left:{x:.2f}pt;top:{y - h:.2f}pt;width:{w:.2f}pt;height:{h:.2f}pt">'
            f'<div class="label" style="width:{h:.2f}pt;height:{w:.2f}pt;transform:translate({w:.2f}pt,0) rotate(90deg);'
            f"font-family:'{f['family']}';font-weight:{f['weight']};font-size:{size:.2f}pt\">"
            f'<span class="t">{esc(fit(b["title"], room, per_letter))}</span><span class="a">{esc(author)}</span></div></div>')

import datetime
DATE = datetime.date.fromisoformat(data['generated']).strftime('%-d %B %Y')
pages = [f'<section class="page right title"><h1>A Library</h1><p class="date">{DATE}</p></section>']
lines = ''.join(f'<div class="line" style="top:{y:.2f}pt"></div>' for y in SHELVES_Y)
# By spread: each spread is one bookcase 11in wide with two shelves; books run
# straight across the fold. A book on the fold is drawn on both pages and each
# page clips it at its edge, so the halves meet when the book lies open.
PER = len(SHELVES_Y)
for i in range(0, len(shelves), PER):
    left_no = len(pages) + 1
    layout = {'left': [], 'right': []}
    for k, shelf in enumerate(shelves[i:i+PER]):
        y, x = SHELVES_Y[k], OUTER
        for b in shelf:
            w = width(b)
            if x < PAGE_W:
                layout['left'].append(spine(b, x, y, left_no))
            if x + w > PAGE_W:
                layout['right'].append(spine(b, x - PAGE_W, y, left_no + 1))
            x += w - 0.5
    for side in ('left', 'right'):
        pages.append(f'<section class="page {side}">{lines}{"".join(layout[side])}<div class="folio {side}">{len(pages)+1}</div></section>')

# Back matter: the index, then the colophon.
# Page number first, right-aligned in its own narrow column, then the title,
# left-aligned, so the eye goes straight from number to book.
index = ''.join(f'<li><b>{page_of[b["slug"]]}</b><span>{esc(b["title"])}{(", " + esc(b["authors"][0])) if b["authors"] else ""}</span></li>' for b in books)
count = {}
for b in books: count[b['face']] = count.get(b['face'], 0) + 1
faces = ''.join(
    f"<li><span style=\"font-family:'{f['family']}';font-weight:{f['weight']};font-size:{9*f['scale']:.1f}pt\">{esc(f['family'])}</span> "
    f"{esc(ABOUT[k][0])}. SIL Open Font License. {count.get(k,0)} spines. {esc(ABOUT[k][1])}</li>" for k, f in FACES.items())
commons_books = [b for b in books if COMMONS & set(b['tags'])]
def sizes():
    n = {}
    for b in books: n[b['sized']] = n.get(b['sized'], 0) + 1
    s = f"I’ve measured {n['measured']} with a ruler. " if n.get('measured') else ''
    s += f"Library catalogues gave me the size of {n.get('library-of-congress', 0) + n.get('open-library', 0)}. "
    s += f"For {n.get('pages', 0)} I only had a page count, so a short rule worked out the thickness from that. "
    s += f"The other {n.get('guessed', 0)} are guesses, and a rule made those too."
    return s
# The write-up lives in essay.md, next to this script, as plain text to edit.
# A blank line starts a new paragraph, "# " is the heading, *stars* make
# italics, and these fill themselves in from the data:
# {books} {date} {scale} {sizes} {commons}
HERE = os.path.dirname(os.path.abspath(__file__))
FILL = {'books': len(books), 'date': DATE, 'scale': 'two fifths' if MODE == 'endless' else 'a quarter',
        'sizes': sizes(), 'commons': len(commons_books)}
def para(t):
    t = esc(t.strip())
    for k, v in FILL.items(): t = t.replace('{' + k + '}', str(v))
    return re.sub(r'\*([^*]+)\*', r'<em>\1</em>', t)
essay = '<div class="back essay">'
for block in re.split(r'\n\s*\n', open(f'{HERE}/essay.md').read().strip()):
    essay += f'<h2>{para(block[2:])}</h2>' if block.startswith('# ') else f'<p>{para(block)}</p>'
essay += '</div>'
back = (essay + f'<div class="back index"><h2>Index</h2><ol>{index}</ol></div>'
        + ''.join('<div class="back blank"></div>' for _ in range(int(__import__('os').environ.get('BLANKS', 0))))
        + f'<div class="back colophon"><h2>Colophon</h2>'
        f'<p>This is a book of the books on Kristian Bjørnard’s office shelves at MICA, filed A to Z by title as they stand there. Each spine is drawn at {'two fifths' if MODE == 'endless' else 'a quarter'} of its size, from library catalogues (Open Library and the Library of Congress), from its page count, or, failing those, a guess.</p>'
        f'<p>It is also a type specimen. Each spine is set in one of thirteen typefaces, all free and open source under the SIL Open Font License: anyone can use, study, change and share them. A series shares a face, and so, mostly, does a publisher. Here is each one, set in itself, and where to get it:</p><ul class="faces">{faces}</ul>'
        f''
        f'<p>Drawn from library.wjerk.shop on {data["generated"]}; the whole catalogue is open at library.wjerk.shop/library.json. Typeset with Bjook (HTML and CSS, printed by WeasyPrint), bjornmeansbook.com. Text CC BY-SA 4.0. The books themselves, their titles and everything else about them, belong to their authors and publishers. A Wjerk project.</p></div>')
doc_pages = ''.join(pages)
doc = f'''<!doctype html><meta charset="utf-8"><style>
{"".join(fontcss)}
@page {{ size: 5.5in 8.5in; margin: 0; }}
@page back {{ margin: 0.5in 0.45in 0.55in; @bottom-center {{ content: counter(page); font: 7pt 'Work Sans'; }} }}
body {{ margin: 0; font-family: 'Work Sans', sans-serif; color: #000; }}
.page {{ position: relative; width: 5.5in; height: 8.5in; page-break-after: always; overflow: hidden; }}
.line {{ position: absolute; left: 0; right: 0; height: 2pt; background: #000; }}
.spine {{ position: absolute; box-sizing: border-box; border: 0.5pt solid #000; border-bottom: 0; overflow: hidden; background: #fff; }}
.spine.commons {{ background: #000; color: #fff; }}
.label {{ position: absolute; top: 0; left: 0; transform-origin: 0 0; box-sizing: border-box; display: flex;
  justify-content: space-between; align-items: center; padding: 0 3pt; line-height: 1; white-space: nowrap; overflow: hidden; }}
.t {{ flex: 1 1 auto; min-width: 0; overflow: hidden; }}
.a {{ flex: 0 0 auto; padding-left: 3pt; font-size: 0.85em; }}
.folio {{ position: absolute; top: 8.15in; font-size: 7pt; }}
.folio.left {{ left: 0.2in; }} .folio.right {{ right: 0.2in; }}
.title {{ display: flex; flex-direction: column; justify-content: flex-end; padding: 0.5in; box-sizing: border-box; }}
.title h1 {{ font-size: 54pt; line-height: 1; margin: 0; letter-spacing: -0.02em; font-weight: 600; }}
.title .date {{ font-size: 12pt; line-height: 1.2; margin: 6pt 0 0; }}
.back.essay {{ font-size: 10pt; line-height: 14pt; }}
.back.essay p {{ margin: 0 0 8pt; }}
.back {{ page: back; page-break-before: always; font-size: 6.5pt; line-height: 1.3; }}
.back h2 {{ font-size: 9pt; font-weight: 600; margin: 0 0 6pt; }}
.index ol {{ list-style: none; margin: 0; padding: 0; columns: 2; column-gap: 12pt; }}
.index li {{ display: flex; gap: 5pt; break-inside: avoid; }}
.index li b {{ flex: 0 0 1.2em; text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }}
.index li span {{ flex: 1 1 auto; }}
@page blank {{ margin: 0; }}
.blank {{ page: blank; height: 1pt; }}
.colophon {{ font-size: 7.5pt; line-height: 1.4; }}
.colophon p {{ margin: 0 0 6pt; }}
.faces {{ list-style: none; margin: 0 0 8pt; padding: 0; }}
.faces li {{ margin: 0 0 3pt; }}
</style>{doc_pages}{back}'''
open(f'{HERE}/build/book.html','w').write(doc)
print(len(shelves), 'shelves,', len(pages), 'pages before the back matter,', len(commons_books), 'commons books')

# The cover, printed separately and wrapped round a perfect-bound book: back,
# spine and front as one sheet with 1/8in bleed. Inside, the book walks along
# one shelf; the cover shows the whole library at once, every book packed into
# one bookcase that fills the sheet and runs off every edge. The title and the
# back-cover text sit on white label cards, the website's shelf label.
PAGES = int(os.environ.get('PAGES', 0))
if PAGES:
    BLEED = 0.125 * PT
    SPINE_W = PAGES * 0.0025 * PT               # 60# uncoated, about 400 pages to the inch
    W, H = 2 * PAGE_W + SPINE_W + 2 * BLEED, 8.5 * PT + 2 * BLEED
    front_x = BLEED + PAGE_W + SPINE_W
    GAP = 4                                      # headroom above the tallest book on each shelf, pt

    def pack(s):
        global SCALE, MINW
        SCALE, MINW = s, 1.2
        rows, row, used = [], [], -6             # each shelf starts just off the left edge
        for b in books:
            w = width(b)
            if row and used + w > W + 6:
                rows.append(row); row, used = [], -6
            row.append(b); used += w
        rows.append(row)
        return rows, sum(max(b['height'] for b in r) * s * PT + GAP for r in rows)
    lo, hi = 0.05, 0.5                           # largest scale whose bookcase still fits the sheet
    for _ in range(30):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if pack(mid)[1] <= H else (lo, mid)
    rows, total = pack(lo)
    SIZE = 4.5 * SCALE / 0.25
    case, y = [], (H - total) / 2 + 1
    shelf_ys = []
    for r in rows:
        y += max(b['height'] for b in r) * SCALE * PT + GAP
        x = -6
        for b in r:
            case.append(spine(b, x, y, 0)); x += width(b) - 0.5
        case.append(f'<div class="line" style="top:{y:.2f}pt"></div>'); shelf_ys.append(y)
    card_front_y = shelf_ys[len(shelf_ys) // 3 - 1]
    blurb = (f'<p>{len(books)} books, drawn spine-out, A to Z, the way they stand on Kristian Bjørnard’s office shelves at MICA. '
             f'Thirteen open-source typefaces, one to a spine. {len(commons_books)} black spines: the books about the commons.</p>'
             f'<p>library.wjerk.shop · A Wjerk project · CC BY-SA 4.0</p>')
    cover = f'''<!doctype html><meta charset="utf-8"><style>
{"".join(fontcss)}
@page {{ size: {W:.2f}pt {H:.2f}pt; margin: 0; }}
body {{ margin: 0; font-family: 'Work Sans', sans-serif; color: #000; }}
.sheet {{ position: relative; width: {W:.2f}pt; height: {H:.2f}pt; overflow: hidden; }}
.line {{ position: absolute; left: 0; right: 0; height: 1.5pt; background: #000; }}
.spine {{ position: absolute; box-sizing: border-box; border: 0.4pt solid #000; border-bottom: 0; overflow: hidden; background: #fff; }}
.spine.commons {{ background: #000; color: #fff; }}
.label {{ position: absolute; top: 0; left: 0; transform-origin: 0 0; box-sizing: border-box; display: flex;
  justify-content: space-between; align-items: center; padding: 0 1.5pt; line-height: 1; white-space: nowrap; overflow: hidden; }}
.t {{ flex: 1 1 auto; min-width: 0; overflow: hidden; }} .a {{ flex: 0 0 auto; padding-left: 1.5pt; font-size: 0.85em; }}
.card {{ position: absolute; background: #fff; border: 2pt solid #000; box-sizing: border-box; }}
.card h1 {{ margin: 0; white-space: nowrap; font-size: 40pt; line-height: 1; letter-spacing: -0.02em; font-weight: 600; }}
.card .date {{ margin: 4pt 0 0; font-size: 11pt; }}
.card p {{ margin: 0 0 6pt; font-size: 8.5pt; line-height: 1.35; }} .card p:last-child {{ margin: 0; }}
</style><div class="sheet">
{"".join(case)}
<div class="card" style="left:{front_x + 0.4*PT:.2f}pt;top:{card_front_y:.2f}pt;transform:translateY(-50%);padding:10pt 14pt 12pt"><h1>A Library</h1><p class="date">{DATE}</p></div>
<div class="card" style="left:{BLEED + 0.4*PT:.2f}pt;top:{shelf_ys[-2]:.2f}pt;transform:translateY(-50%);width:3.4in;padding:9pt 11pt"> {blurb}</div>
</div>'''
    open(f'{HERE}/build/cover.html', 'w').write(cover)
    print(f'cover: {PAGES} pages, spine {SPINE_W/PT:.3f}in, sheet {W/PT:.3f} x {H/PT:.3f}in, books at {SCALE:.3f} scale on {len(rows)} shelves')
