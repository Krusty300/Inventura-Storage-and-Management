"""HTTP-level request rate limiting built on slowapi.

Provides per-endpoint / per-IP limits for the main API surfaces. The
login-specific failed-attempt lockout (``app.services.ratelimit``) is separate
and kept as-is because it carries per-username lockout semantics that slowapi's
per-IP counters do not.

Keyed by client IP by default. ``limit("60/minute")`` decorates an endpoint;
``limiter.limit()`` can be used for shared-scope limits. The limiter is
instantiated here so that both ``main.py`` and individual routers import the
same instance. When rate limiting is disabled (tests, local dev flag), it
becomes a no-op.
"""

from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address
from fastapi.responses import JSONResponse

import os

# Allow tests and local dev to disable ambient limits (e.g. set
# DISABLE_RATE_LIMIT=1 when running the test suite, which hammers endpoints).
RATE_LIMIT_ENABLED = os.getenv("DISABLE_RATE_LIMIT", "").lower() not in ("1", "true", "yes")

limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["600/minute"],
    enabled=RATE_LIMIT_ENABLED,
    storage_uri="memory://",
)


def rate_limit_exceeded_handler(request: Request, exc):
    """Return a structured 429 response instead of slowapi's default."""
    return JSONResponse(
        status_code=429,
        content={
            "detail": "Too many requests. Please slow down and try again.",
            "retry_after": getattr(exc, "retry_after", "later"),
        },
        headers={"Retry-After": str(getattr(exc, "retry_after", "60"))},
    )
