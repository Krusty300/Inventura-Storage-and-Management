"""Structured JSON logging with request IDs."""

import logging
import json
import uuid
from contextvars import ContextVar
from datetime import datetime, timezone

_request_id_var: ContextVar[str] = ContextVar("request_id", default="-")


def get_request_id() -> str:
    return _request_id_var.get()


def set_request_id(rid: str) -> None:
    _request_id_var.set(rid)


def new_request_id() -> str:
    rid = uuid.uuid4().hex[:12]
    set_request_id(rid)
    return rid


class JSONFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        log = {
            "ts": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            "request_id": get_request_id(),
        }
        if record.exc_info and record.exc_info[0]:
            log["exc"] = self.formatException(record.exc_info)
        if hasattr(record, "extra_data"):
            log["data"] = record.extra_data
        return json.dumps(log, default=str)


class TextFormatter(logging.Formatter):
    """Human-readable formatter for local development."""

    COLORS = {
        "DEBUG": "\033[36m",
        "INFO": "\033[32m",
        "WARNING": "\033[33m",
        "ERROR": "\033[31m",
        "CRITICAL": "\033[1;31m",
    }
    RESET = "\033[0m"

    def format(self, record: logging.LogRecord) -> str:
        color = self.COLORS.get(record.levelname, "")
        rid = get_request_id()
        ts = datetime.fromtimestamp(record.created).strftime("%H:%M:%S")
        msg = f"{color}{record.levelname:<8}{self.RESET} [{ts}] [{rid}] {record.name}: {record.getMessage()}"
        if record.exc_info and record.exc_info[0]:
            msg += f"\n{self.formatException(record.exc_info)}"
        return msg


def setup_logging(level: str = "INFO", json_output: bool = False) -> None:
    root = logging.getLogger()
    root.setLevel(getattr(logging, level.upper(), logging.INFO))

    for h in root.handlers[:]:
        root.removeHandler(h)

    handler = logging.StreamHandler()
    handler.setFormatter(JSONFormatter() if json_output else TextFormatter())
    root.addHandler(handler)


def log_event(logger_name: str, level: str, msg: str, **kwargs) -> None:
    logger = logging.getLogger(logger_name)
    record = logger.makeRecord(logger_name, getattr(logging, level.upper()), "", 0, msg, (), None)
    if kwargs:
        record.extra_data = kwargs
    logger.handle(record)
