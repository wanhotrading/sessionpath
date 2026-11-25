"""Attach the shared dropdown stylesheet to published pages with select menus."""
import hashlib
from pathlib import Path
from posixpath import relpath
import re
import sys

root = Path(sys.argv[1]).resolve()
css_name = "dropdown-motion.css"
version = hashlib.sha256((root / css_name).read_bytes()).hexdigest()[:12]
select = re.compile(rb"<select\b", re.I)
head_end = re.compile(rb"</head\s*>", re.I)
updated = 0

for page in sorted(root.rglob("*.html")):
    html = page.read_bytes()
    if not select.search(html):
        continue
    if re.search(rb"<link\b[^>]*\bdropdown-motion\.css\b", html, re.I):
        continue
    head = head_end.search(html)
    if not head:
        print(f"Skipped {page.relative_to(root)}: no closing head")
        continue
    href = relpath(css_name, page.parent.relative_to(root).as_posix())
    tag = f'<link rel="stylesheet" href="{href}?v={version}">\n'.encode()
    page.write_bytes(html[:head.start()] + tag + html[head.start():])
    updated += 1

print(f"Included dropdown motion on {updated} pages.")
