import asyncio
import json

import pytest


class FakeWS:
    def __init__(self, name):
        self.name = name
        self.sent: list[str] = []
        self.closed = False

    async def send_text(self, payload: str):
        self.sent.append(payload)

    async def accept(self):
        self.accepted = True

    def __eq__(self, other):
        return isinstance(other, FakeWS) and other.name == self.name

    def __hash__(self):
        return hash(self.name)


def test_send_to_user_only_reaches_that_user():
    from app.ws_manager import ConnectionManager

    async def run():
        ws_user1_a = FakeWS("u1-a")
        ws_user1_b = FakeWS("u1-b")
        ws_user2 = FakeWS("u2")

        await cm.connect(ws_user1_a, user_id=1)
        await cm.connect(ws_user1_b, user_id=1)
        await cm.connect(ws_user2, user_id=2)

        await cm.send_to_user(1, {"event": "entity_changed", "entity": "notification", "action": "created"})

        return ws_user1_a, ws_user1_b, ws_user2

    cm = ConnectionManager()
    ws_user1_a, ws_user1_b, ws_user2 = asyncio.run(run())

    assert len(ws_user1_a.sent) == 1
    assert len(ws_user1_b.sent) == 1
    assert ws_user2.sent == []
    payload = json.loads(ws_user1_a.sent[0])
    assert payload["entity"] == "notification"


def test_send_to_user_after_disconnect():
    from app.ws_manager import ConnectionManager

    async def run():
        await cm.connect(ws, user_id=1)
        cm.disconnect(ws)
        await cm.send_to_user(1, {"event": "entity_changed", "entity": "notification", "action": "updated"})

    cm = ConnectionManager()
    ws = FakeWS("u1")
    asyncio.run(run())

    assert ws.sent == []
    assert 1 not in cm._user_sockets
    assert ws not in cm.connections


def test_send_to_unknown_user_noop():
    from app.ws_manager import ConnectionManager

    async def run():
        await cm.send_to_user(999, {"event": "entity_changed", "entity": "notification", "action": "created"})

    cm = ConnectionManager()
    asyncio.run(run())
    assert cm.connections == []


def test_disconnect_removes_only_that_socket():
    from app.ws_manager import ConnectionManager

    async def run():
        await cm.connect(ws1, user_id=1)
        await cm.connect(ws1b, user_id=1)
        await cm.connect(ws2, user_id=2)
        cm.disconnect(ws1)

    cm = ConnectionManager()
    ws1 = FakeWS("u1-a")
    ws1b = FakeWS("u1-b")
    ws2 = FakeWS("u2")
    asyncio.run(run())

    assert ws1 not in cm.connections
    assert ws1b in cm.connections
    assert ws2 in cm.connections
    assert cm._user_sockets[1] == [ws1b]
