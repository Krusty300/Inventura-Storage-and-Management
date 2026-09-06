"""Small in-process TTL cache helpers built on cachetools.

Suitable for single-process (or development) deployments and for memoizing
cheap-to-recompute but frequently-read lookup data (settings, static lists).
Do NOT use for per-user or security-sensitive data longer than necessary.
"""

from cachetools import TTLCache

# Settings row: users/whole app read it on nearly every request that computes
# currency, tax, prefixes, etc. Fresh enough at 60s.
settings_cache: TTLCache = TTLCache(maxsize=16, ttl=60)

# Static reference lists that rarely change (locations, sales channels) refresh
# every 5 minutes.
reference_cache: TTLCache = TTLCache(maxsize=64, ttl=300)
