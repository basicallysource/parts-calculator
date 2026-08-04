#!/usr/bin/env python3
"""Verify every product-image URL the site ships actually serves a real image.

This exists because a broken image is invisible to every other check we run.
The bucket is content-addressed, so a wrong URL is not a 404 -- it is a 200
with the wrong bytes. When slicer/images/** was briefly LFS-tracked, CI hashed
and uploaded 130-byte pointer stubs; every URL looked healthy, returned 200
with Content-Type: image/png, and rendered as a broken image on production.

So status codes prove nothing here. This checks the bytes: each URL must return
a real PNG/JPEG magic number, and must not be LFS pointer text.

    python scripts/check_image_urls.py [path/to/parts.generated.json]

Exits non-zero listing every URL that is not a decodable image.
"""
import concurrent.futures
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DEFAULT = REPO / "src/lib/data/parts.generated.json"

# An image smaller than this is not a real product photo; the LFS pointer stubs
# that broke production were 130 bytes.
MIN_BYTES = 1024
MAGIC = {b"\x89PNG\r\n\x1a\n": "png", b"\xff\xd8\xff": "jpeg"}
LFS_POINTER = b"version https://git-lfs"


def image_urls(path: Path) -> list[str]:
    """Every http(s) image URL in the generated data, de-duplicated."""
    blob = path.read_text()
    # `image_url` is the authored field in slicer/parts.json; `image` is what it
    # becomes in the generated data. Accepting both means this runs against
    # either file -- the source can be checked without invoking the slicer.
    urls = re.findall(r'"image(?:_url)?":\s*"(https?://[^"]+)"', blob)
    return sorted(set(urls))


def check(url: str) -> tuple[str, str | None]:
    """Return (url, error) -- error is None when the URL serves a real image."""
    try:
        req = urllib.request.Request(url, headers={"Range": "bytes=0-1023"})
        with urllib.request.urlopen(req, timeout=30) as r:
            head = r.read()
            # 206 gives the range; a 200 means the whole (small) object came back.
            total = r.headers.get("Content-Range")
            size = int(total.split("/")[-1]) if total else len(head)
    except urllib.error.HTTPError as e:
        return url, f"HTTP {e.code}"
    except Exception as e:  # network/DNS/timeout
        return url, f"unreachable: {type(e).__name__}"

    if head.startswith(LFS_POINTER):
        return url, (
            "serves a Git LFS pointer, not an image -- something hashed and "
            "uploaded an unmaterialized LFS file"
        )
    if size < MIN_BYTES:
        return url, f"only {size} bytes -- not a real image"
    if not any(head.startswith(m) for m in MAGIC):
        return url, f"bad magic bytes {head[:8]!r} -- not a PNG or JPEG"
    return url, None


def main() -> None:
    path = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else DEFAULT
    if not path.exists():
        sys.exit(f"no such file: {path}")

    urls = image_urls(path)
    if not urls:
        sys.exit(f"no image URLs found in {path} -- the regex or the schema changed")

    with concurrent.futures.ThreadPoolExecutor(8) as ex:
        results = list(ex.map(check, urls))

    bad = [(u, e) for u, e in results if e]
    try:
        shown = path.relative_to(REPO)
    except ValueError:
        shown = path
    print(f"checked {len(urls)} product image URLs from {shown}")
    if not bad:
        print("all serve real images")
        return

    print(f"\n{len(bad)} broken:", file=sys.stderr)
    for u, e in bad:
        print(f"  {u}\n    {e}", file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    main()
