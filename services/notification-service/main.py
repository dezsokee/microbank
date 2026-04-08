import json
import logging
import os
import sys
from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4

from fastapi import FastAPI, Query, Request
from fastapi.responses import JSONResponse
from prometheus_fastapi_instrumentator import Instrumentator
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# JSON logging to stdout
# ---------------------------------------------------------------------------


class JsonLogFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        log_record = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "message": record.getMessage(),
            "logger": record.name,
        }
        if record.exc_info and record.exc_info[0] is not None:
            log_record["exception"] = self.formatException(record.exc_info)
        return json.dumps(log_record)


handler = logging.StreamHandler(sys.stdout)
handler.setFormatter(JsonLogFormatter())
logging.root.handlers = [handler]
logging.root.setLevel(logging.INFO)

logger = logging.getLogger("notification-service")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

PORT = int(os.getenv("PORT", "8086"))

# ---------------------------------------------------------------------------
# In-memory store
# ---------------------------------------------------------------------------

notifications: list[dict] = []

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class NotificationRequest(BaseModel):
    type: str = Field(..., examples=["TRANSFER_COMPLETED"])
    userId: str = Field(..., examples=["uuid-1"])
    transactionId: Optional[str] = Field(None, examples=["tx-uuid"])
    message: str = Field(
        ..., examples=["Transfer of 100.00 EUR to acc-2 completed successfully"]
    )


class NotificationResponse(BaseModel):
    id: str
    status: str
    channel: str
    timestamp: str


class NotificationItem(BaseModel):
    id: str
    type: str
    message: str
    timestamp: str


class NotificationListResponse(BaseModel):
    notifications: list[NotificationItem]


class ErrorResponse(BaseModel):
    error: str
    message: str
    timestamp: str


# ---------------------------------------------------------------------------
# FastAPI application
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Notification Service",
    description="MicroBank Notification Service - stores and sends notifications",
    version="1.0.0",
)

# Prometheus metrics
Instrumentator().instrument(app).expose(app, endpoint="/metrics")

# ---------------------------------------------------------------------------
# Exception handlers
# ---------------------------------------------------------------------------


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    logger.error("Unhandled exception: %s", str(exc), exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "error": "INTERNAL_ERROR",
            "message": "An unexpected error occurred",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.get("/healthz")
async def health_check():
    return {"status": "UP", "service": "notification-service"}


@app.post("/api/v1/notifications", response_model=NotificationResponse, status_code=201)
async def send_notification(payload: NotificationRequest):
    notif_id = str(uuid4())
    now = datetime.now(timezone.utc).isoformat()

    notification = {
        "id": notif_id,
        "type": payload.type,
        "userId": payload.userId,
        "transactionId": payload.transactionId,
        "message": payload.message,
        "status": "SENT",
        "channel": "EMAIL",
        "timestamp": now,
    }

    notifications.append(notification)

    # Log the notification in JSON format to stdout
    logger.info(
        json.dumps(
            {
                "event": "NOTIFICATION_SENT",
                "notificationId": notif_id,
                "type": payload.type,
                "userId": payload.userId,
                "transactionId": payload.transactionId,
                "channel": "EMAIL",
                "message": payload.message,
            }
        )
    )

    return NotificationResponse(
        id=notif_id,
        status="SENT",
        channel="EMAIL",
        timestamp=now,
    )


@app.get("/api/v1/notifications", response_model=NotificationListResponse)
async def list_notifications(userId: Optional[str] = Query(None)):
    if userId:
        filtered = [n for n in notifications if n["userId"] == userId]
    else:
        filtered = list(notifications)

    items = [
        NotificationItem(
            id=n["id"],
            type=n["type"],
            message=n["message"],
            timestamp=n["timestamp"],
        )
        for n in filtered
    ]

    return NotificationListResponse(notifications=items)
