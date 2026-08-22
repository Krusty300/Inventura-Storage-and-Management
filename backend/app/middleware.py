"""Middleware for request IDs and structured request/response logging."""

import logging
import time
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.logging_config import new_request_id, set_request_id

logger = logging.getLogger("app.access")


class RequestIDMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        rid = request.headers.get("X-Request-ID") or new_request_id()
        set_request_id(rid)

        start = time.monotonic()
        response = await call_next(request)
        elapsed_ms = round((time.monotonic() - start) * 1000, 1)

        response.headers["X-Request-ID"] = rid
        logger.info(
            "%s %s -> %s (%sms)",
            request.method,
            request.url.path,
            response.status_code,
            elapsed_ms,
        )
        return response
