"""Official-API publishers (system 12 of the spec).

One module per platform behind a common interface (see base.py and
registry.py). Every publisher is DISABLED unless its credential env
vars are set, and dry-run is the default — nothing auto-publishes.
"""

from publishers.base import Publisher  # noqa: F401
from publishers.registry import (  # noqa: F401
    ALL_PUBLISHERS,
    get_publisher,
    status_list,
)
