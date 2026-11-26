#!/bin/sh
# ./build.sh  ->  build/a-library.pdf (the pages) and build/a-library-cover.pdf
# Edit essay.md for the write-up. MODE=wall ./build.sh for the two-shelf version.
# The pages are padded to an even count, so the colophon lands on the last page.
set -e
cd "$(dirname "$0")"
mkdir -p build
MODE=${MODE:-endless}; export MODE
out=build/a-library; [ "$MODE" = endless ] || out=build/a-library-$MODE
BLANKS=0 python3 shelf-book.py >/dev/null && weasyprint -q build/book.html "$out.pdf"
n=$(pdfinfo "$out.pdf" | awk '/^Pages/{print $2}')
if [ $((n % 2)) -eq 1 ]; then
  BLANKS=1 python3 shelf-book.py >/dev/null && weasyprint -q build/book.html "$out.pdf"
  n=$(pdfinfo "$out.pdf" | awk '/^Pages/{print $2}')
fi
PAGES=$n python3 shelf-book.py | tail -1 && weasyprint -q build/cover.html "$out-cover.pdf"
echo "$out.pdf: $n pages"
