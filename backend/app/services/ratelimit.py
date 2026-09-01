"""In-memory failed-login rate limiting / lockout.

Keys are per-username and per-IP. This is per-process state; acceptable for a
single-worker deployment. Limits are read at call time so tests can
monkeypatch them.
"""

import threading
import time

LOCKOUT_WINDOW_SECONDS = 15 * 60
MAX_FAILED_PER_USER = 5
MAX_FAILED_PER_IP = 20

_failures: dict[str, list[float]] = {}
_lock = threading.Lock()


def _now() -> float:
    return time.time()


def _prune(records: list[float]) -> list[float]:
    cutoff = _now() - LOCKOUT_WINDOW_SECONDS
    return [t for t in records if t > cutoff]


def _prune_since(records: list[float], window_seconds: float) -> list[float]:
    cutoff = _now() - window_seconds
    return [t for t in records if t > cutoff]


def _count(key: str) -> int:
    with _lock:
        records = _prune(_failures.get(key, []))
        if not records:
            _failures.pop(key, None)
        else:
            _failures[key] = records
        return len(records)


def record_failure(username: str, ip: str) -> None:
    now = _now()
    with _lock:
        for key in (f"u:{username}", f"ip:{ip}"):
            records = _prune(_failures.get(key, []))
            records.append(now)
            _failures[key] = records


def clear_failures(username: str, ip: str) -> None:
    with _lock:
        _failures.pop(f"u:{username}", None)
        _failures.pop(f"ip:{ip}", None)


def lockout_message(username: str, ip: str) -> str | None:
    """Return a lockout message if the user or IP is locked out, else None."""
    if _count(f"u:{username}") >= MAX_FAILED_PER_USER:
        return "Too many failed login attempts for this account. Try again later."
    if _count(f"ip:{ip}") >= MAX_FAILED_PER_IP:
        return "Too many failed login attempts. Try again later."
    return None


REGISTER_WINDOW_SECONDS = 60 * 60
MAX_REGISTRATIONS_PER_IP = 5


def register_rate_limited(ip: str) -> str | None:
    """Return an error message if the IP has registered too many accounts, else None.

    Uses a separate in-memory counter so sign-up spam is throttled without
    interacting with the failed-login lockout state.
    """
    key = f"register:{ip}"
    with _lock:
        records = _prune_since(_failures.get(key, []), REGISTER_WINDOW_SECONDS)
        if len(records) >= MAX_REGISTRATIONS_PER_IP:
            _failures[key] = records
            return "Too many accounts created from this address. Try again later."
        records.append(_now())
        _failures[key] = records
    return None


def reset() -> None:
    with _lock:
        _failures.clear()
