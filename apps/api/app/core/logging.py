import logging
import os
import sys

from pythonjsonlogger import jsonlogger


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
    root.setLevel(os.getenv("LOG_LEVEL", "INFO").upper())
