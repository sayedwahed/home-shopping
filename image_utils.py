"""Template helper for optimized product images (system 16).

`optimized_url(image_url, product_id, width)` returns the local
/static/optimized/<product-id>-<width>.jpg URL when that file exists
(written by scripts/optimize_images.py) and the original remote URL
otherwise. The storefront never breaks when no optimized copy exists.
"""

import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def optimized_url(image_url, product_id, width=800):
    if not image_url or not product_id:
        return image_url
    name = "%s-%d.jpg" % (product_id, width)
    path = os.path.join(BASE_DIR, "static", "optimized", name)
    if os.path.exists(path):
        return "/static/optimized/" + name
    return image_url
