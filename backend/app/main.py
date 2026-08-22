from dotenv import load_dotenv
from pathlib import Path
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

import asyncio
import os
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from jose import JWTError, jwt

from app.config import settings as app_settings
from app.database import Base, SessionLocal, backfill_stock_lines, engine, run_migrations
from app.logging_config import setup_logging
from app.middleware import RequestIDMiddleware
from app.routers import activity_log, asn, auth, bom, categories, costing, cycle_counts, customers, customer_groups, daraja, dashboard, forecasting, labels, locations, lots, lpns, notes, notifications, orders, planning, price_lists, products, promotions, quality_checks, receipts, reports, sales, sales_channels, search, serial_numbers, settings, shipments, stock, suppliers, users, work_orders
from app.services.inventory import expire_overdue_lots
from app.ws_manager import manager

setup_logging(
    level=os.getenv("LOG_LEVEL", "INFO"),
    json_output=os.getenv("LOG_JSON", "false").lower() in ("1", "true", "yes"),
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    run_migrations()
    Base.metadata.create_all(bind=engine)
    backfill_stock_lines()
    db = SessionLocal()
    try:
        expire_overdue_lots(db)
    finally:
        db.close()
    manager.init(asyncio.get_running_loop())
    yield


app = FastAPI(title="Inventory Management System", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(RequestIDMiddleware)

app.include_router(activity_log.router)
app.include_router(auth.router)
app.include_router(products.router)
app.include_router(reports.router)
app.include_router(categories.router)
app.include_router(customers.router)
app.include_router(customer_groups.router)
app.include_router(suppliers.router)
app.include_router(stock.router)
app.include_router(receipts.router)
app.include_router(lots.router)
app.include_router(serial_numbers.router)
app.include_router(locations.router)
app.include_router(asn.router)
app.include_router(labels.router)
app.include_router(lpns.router)
app.include_router(cycle_counts.router)
app.include_router(orders.router)
app.include_router(dashboard.router)
app.include_router(users.router)
app.include_router(settings.router)
app.include_router(sales.router)
app.include_router(sales_channels.router)
app.include_router(notifications.router)
app.include_router(bom.router)
app.include_router(work_orders.router)
app.include_router(quality_checks.router)
app.include_router(planning.router)
app.include_router(forecasting.router)
app.include_router(costing.router)
app.include_router(shipments.router)
app.include_router(daraja.router)
app.include_router(search.router)
app.include_router(notes.router)
app.include_router(price_lists.router)
app.include_router(promotions.router)

uploads_dir = Path(__file__).resolve().parent / "uploads"
uploads_dir.mkdir(exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket, token: str = Query("")):
    if not token:
        await ws.close(code=4001, reason="Authentication required")
        return
    try:
        payload = jwt.decode(token, app_settings.secret_key, algorithms=[app_settings.algorithm])
        user_id = payload.get("sub")
        if user_id is None:
            await ws.close(code=4001, reason="Invalid token")
            return
    except (JWTError, ValueError, TypeError):
        await ws.close(code=4001, reason="Invalid token")
        return
    await manager.connect(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(ws)


@app.get("/api/health")
def health():
    return {"status": "ok"}
