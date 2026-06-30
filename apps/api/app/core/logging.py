import logging
import sys

from pythonjsonlogger import jsonlogger

from app.core.config import get_settings


def configure_logging() -> None:
    """Swap the root logger to a JSON formatter writing to stdout.

    Lambda forwards stdout to CloudWatch, where JSON lines become structured,
    queryable fields in Logs Insights. Call once at startup before app creation.
    """
    handler = logging.StreamHandler(sys.stdout)
    formatter = jsonlogger.JsonFormatter(
        "%(asctime)s %(levelname)s %(name)s %(message)s",
        rename_fields={"asctime": "timestamp", "levelname": "level"},
    )
    handler.setFormatter(formatter)

    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(get_settings().log_level.upper())

    # Third-party HTTP internals are extremely chatty at DEBUG/INFO (per-frame
    # HTTP/2 + HPACK decode lines, one INFO per outbound request). Pin them to
    # WARNING so app logs — the access log and our own events — stay readable
    # even when LOG_LEVEL=DEBUG.
    for noisy in ("httpcore", "httpx", "hpack", "h2", "hpack.hpack", "hpack.table"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
