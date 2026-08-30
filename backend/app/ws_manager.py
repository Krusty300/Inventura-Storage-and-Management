import asyncio
import json
from fastapi import WebSocket


class ConnectionManager:
    def __init__(self):
        self.connections: list[WebSocket] = []
        self._user_sockets: dict[int, list[WebSocket]] = {}
        self._loop: asyncio.AbstractEventLoop | None = None

    def init(self, loop: asyncio.AbstractEventLoop):
        self._loop = loop

    async def connect(self, ws: WebSocket, user_id: int | None = None):
        await ws.accept()
        self.connections.append(ws)
        if user_id is not None:
            self._user_sockets.setdefault(user_id, []).append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self.connections:
            self.connections.remove(ws)
        for user_id, sockets in list(self._user_sockets.items()):
            if ws in sockets:
                sockets.remove(ws)
                if not sockets:
                    del self._user_sockets[user_id]

    async def broadcast(self, message: dict):
        payload = json.dumps(message)
        dead: list[WebSocket] = []
        for ws in self.connections:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

    async def send_to_user(self, user_id: int, message: dict):
        payload = json.dumps(message)
        dead: list[WebSocket] = []
        for ws in self._user_sockets.get(user_id, []):
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

    def broadcast_sync(self, message: dict):
        if self._loop and self._loop.is_running():
            asyncio.run_coroutine_threadsafe(self.broadcast(message), self._loop)

    def send_to_user_sync(self, user_id: int, message: dict):
        if self._loop and self._loop.is_running():
            asyncio.run_coroutine_threadsafe(self.send_to_user(user_id, message), self._loop)


manager = ConnectionManager()
