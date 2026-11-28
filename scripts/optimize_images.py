#!/usr/bin/env python3
"""Image optimization (system 16 of the spec).

Downloads each product image from its AliExpress URL and writes
resized, compressed copies under static/optimized/:

    static/optimized/<product-id>-<width>.jpg

Widths default to 400 and 800. The storefront serves the optimized
file when it exists (see image_utils.optimized_url) and falls back to
the original remote URL otherwise. Re-running only re-creates files
that are missing or older than the source check — in practice it just
overwrites with the same output, so it is safe to run any time.

Enhancement (free, Pillow-only, no external service): after resizing,
each copy gets a conservative enhancement pass — autocontrast with a
1% cutoff (fixes flat/washed-out supplier photos without clipping),
a small colour lift, and a light sharpen that compensates for the
softening caused by downscaling. Values are deliberately mild:
supplier photos are already processed, so heavy filters would look
worse, not better. Use --no-enhance to skip it.

Optional upload to ImgBB / Cloudinary happens ONLY when the matching
keys are set (IMGBB_API_KEY / CLOUDINARY_URL); otherwise the step is
skipped and reported as disabled — never a failure.

Usage:
    python scripts/optimize_images.py
    python scripts/optimize_images.py --widths 400 800 1200 --quality 80
"""

import argparse
import io
import os
import sys

import requests

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import db as store_db  # noqa: E402

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(BASE_DIR, "static", "optimized")


def enhance(img):
    """Conservative free enhancement for supplier photos.

    Order matters: autocontrast first (fixes flat exposure), then a
    small colour lift, then a light sharpen to undo downscale
    softening. All factors are mild on purpose — these photos are
    already processed by the seller, so aggressive values would
    clip highlights, oversaturate, or add halos.
    """
    from PIL import ImageEnhance, ImageOps

    img = ImageOps.autocontrast(img, cutoff=1)
    img = ImageEnhance.Color(img).enhance(1.06)
    img = ImageEnhance.Sharpness(img).enhance(1.25)
    return img


def optimize_one(image_url, product_id, widths, quality, enhance_flag=True):
    """Download + resize (+ optionally enhance) one image.

    Returns a list of written paths.
    """
    from PIL import Image

    resp = requests.get(image_url, timeout=30,
                        headers={"User-Agent": "HomeShopping/1.0"})
    resp.raise_for_status()
    img = Image.open(io.BytesIO(resp.content)).convert("RGB")
    written = []
    for width in widths:
        if img.width <= width:
            out = img
        else:
            ratio = width / img.width
            out = img.resize((width, int(img.height * ratio)),
                             Image.LANCZOS)
        if enhance_flag:
            out = enhance(out)
        dest = os.path.join(OUT_DIR, "%s-%d.jpg" % (product_id, width))
        out.save(dest, "JPEG", quality=quality, optimize=True)
        written.append(dest)
    return written


def maybe_upload(path):
    """Optional ImgBB upload (only when IMGBB_API_KEY is set)."""
    key = os.environ.get("IMGBB_API_KEY")
    if not key:
        return {"status": "disabled",
                "detail": "IMGBB_API_KEY not set; upload skipped."}
    try:
        with open(path, "rb") as f:
            resp = requests.post(
                "https://api.imgbb.com/1/upload",
                params={"key": key}, files={"image": f}, timeout=60)
        resp.raise_for_status()
        url = resp.json().get("data", {}).get("url")
        return {"status": "uploaded", "url": url}
    except Exception as exc:  # noqa: BLE001 - report, never crash
        return {"status": "error", "detail": str(exc)}


def main():
    parser = argparse.ArgumentParser(description="Optimize product images.")
    parser.add_argument("--widths", type=int, nargs="+", default=[400, 800])
    parser.add_argument("--quality", type=int, default=82)
    parser.add_argument("--no-enhance", action="store_true",
                        help="Skip the autocontrast/colour/sharpen pass")
    parser.add_argument("--upload", action="store_true",
                        help="Also upload to ImgBB when IMGBB_API_KEY is set")
    args = parser.parse_args()

    os.makedirs(OUT_DIR, exist_ok=True)
    conn = store_db.connect()
    try:
        products = store_db.get_all_products(conn)
    finally:
        conn.close()
    total = 0
    for p in products:
        if not p["image_url"]:
            print("  %s: no image URL, skipped" % p["id"])
            continue
        try:
            written = optimize_one(p["image_url"], p["id"],
                                   args.widths, args.quality,
                                   enhance_flag=not args.no_enhance)
            total += len(written)
            print("  %s: %s" % (p["id"], ", ".join(
                os.path.relpath(w, BASE_DIR) for w in written)))
            if args.upload:
                for w in written:
                    print("    upload: %s" % maybe_upload(w))
        except Exception as exc:  # noqa: BLE001 - one bad image skips one product
            print("  %s: FAILED (%s)" % (p["id"], exc))
    print("Done. %d optimized file(s) in static/optimized/." % total)
    return 0


if __name__ == "__main__":
    sys.exit(main())
