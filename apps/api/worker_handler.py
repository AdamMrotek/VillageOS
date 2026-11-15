"""Lambda entry point for the notification worker.

Invoked on a schedule by EventBridge (see NotificationWorkerFunction in
template.yaml). Separate from lambda_handler.py, which serves the HTTP API.
"""

from typing import Any

from dotenv import load_dotenv

from app.core.logging import configure_logging
from app.services import notifications

load_dotenv()
configure_logging()


def handler(event: Any, context: Any) -> dict[str, int]:
    return notifications.run()
