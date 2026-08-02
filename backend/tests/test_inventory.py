from datetime import date

import pytest

from app.models import Location, Lot, Product, SerialNumber, User
from app.services import inventory
from app.services.inventory import InventoryError
from tests.conftest import TestingSessionLocal


@pytest.fixture
def db():
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


def _make_user(db, username="warehouse"):
    user = User(username=username, email=f"{username}@example.com", password_hash="x")
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _make_product(db, sku, **kwargs):
    product = Product(sku=sku, name=sku, **kwargs)
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


def _make_location(db, name, parent_id=None, code=None):
    location = Location(name=name, parent_id=parent_id, code=code)
    db.add(location)
    db.commit()
    db.refresh(location)
    return location


def _make_lot(db, product_id, lot_number, expiry_date=None):
    lot = Lot(product_id=product_id, lot_number=lot_number, expiry_date=expiry_date)
    db.add(lot)
    db.commit()
    db.refresh(lot)
    return lot


class TestReceive:
    def test_receive_creates_stock_line(self, db):
        user = _make_user(db)
        product = _make_product(db, "SKU-1")
        loc_a = _make_location(db, "Warehouse A", code="WA")

        inventory.post_journal_entry(
            db, product_id=product.id, user_id=user.id,
            quantity_change=10, movement_type=inventory.RECEIVE,
            to_location_id=loc_a.id,
        )
        db.commit()

        assert inventory.on_hand(db, product_id=product.id) == 10
        assert inventory.on_hand(db, product_id=product.id, location_id=loc_a.id) == 10

    def test_receive_same_identity_accumulates_on_one_line(self, db):
        user = _make_user(db)
        product = _make_product(db, "SKU-2")
        lot = _make_lot(db, product.id, "LOT-1")

        inventory.post_journal_entry(
            db, product_id=product.id, user_id=user.id,
            quantity_change=5, movement_type=inventory.RECEIVE,
            to_location_id=None, lot_id=lot.id,
        )
        inventory.post_journal_entry(
            db, product_id=product.id, user_id=user.id,
            quantity_change=3, movement_type=inventory.RECEIVE,
            to_location_id=None, lot_id=lot.id,
        )
        db.commit()

        from app.models import StockLine
        lines = db.query(StockLine).filter(StockLine.product_id == product.id).all()
        assert len(lines) == 1
        assert lines[0].quantity == 8

    def test_receive_different_lots_creates_separate_lines(self, db):
        user = _make_user(db)
        product = _make_product(db, "SKU-3")
        lot1 = _make_lot(db, product.id, "LOT-A")
        lot2 = _make_lot(db, product.id, "LOT-B")

        for lot in (lot1, lot2):
            inventory.post_journal_entry(
                db, product_id=product.id, user_id=user.id,
                quantity_change=4, movement_type=inventory.RECEIVE, lot_id=lot.id,
            )
        db.commit()

        assert inventory.on_hand(db, product_id=product.id) == 8
        assert inventory.on_hand(db, product_id=product.id, lot_id=lot1.id) == 4

    def test_receive_into_location_paths(self, db):
        user = _make_user(db)
        product = _make_product(db, "SKU-4")
        zone = _make_location(db, "Zone 1")
        bin = _make_location(db, "Bin A", parent_id=zone.id, code="A-01")

        inventory.post_journal_entry(
            db, product_id=product.id, user_id=user.id,
            quantity_change=6, movement_type=inventory.RECEIVE, to_location_id=bin.id,
        )
        db.commit()

        assert bin.path == "Zone 1 / Bin A"
        assert inventory.on_hand(db, product_id=product.id, location_id=bin.id) == 6


class TestOutbound:
    def test_sale_reduces_stock(self, db):
        user = _make_user(db)
        product = _make_product(db, "SKU-5")
        loc_a = _make_location(db, "WH-1")

        inventory.post_journal_entry(
            db, product_id=product.id, user_id=user.id,
            quantity_change=10, movement_type=inventory.RECEIVE, to_location_id=loc_a.id,
        )
        inventory.post_journal_entry(
            db, product_id=product.id, user_id=user.id,
            quantity_change=-4, movement_type=inventory.SALE,
            from_location_id=loc_a.id, reference_type="sale", reference="INV-100",
        )
        db.commit()

        assert inventory.on_hand(db, product_id=product.id) == 6

    def test_outbound_beyond_stock_raises(self, db):
        user = _make_user(db)
        product = _make_product(db, "SKU-6")
        loc_a = _make_location(db, "WH-2")

        inventory.post_journal_entry(
            db, product_id=product.id, user_id=user.id,
            quantity_change=2, movement_type=inventory.RECEIVE, to_location_id=loc_a.id,
        )
        db.commit()

        with pytest.raises(InventoryError, match="Insufficient"):
            inventory.post_journal_entry(
                db, product_id=product.id, user_id=user.id,
                quantity_change=-3, movement_type=inventory.SALE,
                from_location_id=loc_a.id,
            )
        db.rollback()

        assert inventory.on_hand(db, product_id=product.id) == 2

    def test_outbound_to_zero_deletes_line(self, db):
        user = _make_user(db)
        product = _make_product(db, "SKU-7")
        loc_a = _make_location(db, "WH-3")

        inventory.post_journal_entry(
            db, product_id=product.id, user_id=user.id,
            quantity_change=2, movement_type=inventory.RECEIVE, to_location_id=loc_a.id,
        )
        inventory.post_journal_entry(
            db, product_id=product.id, user_id=user.id,
            quantity_change=-2, movement_type=inventory.SALE, from_location_id=loc_a.id,
        )
        db.commit()

        from app.models import StockLine
        lines = db.query(StockLine).filter(StockLine.product_id == product.id).all()
        assert len(lines) == 0
        assert inventory.on_hand(db, product_id=product.id) == 0


class TestTransfer:
    def test_transfer_moves_stock_between_locations(self, db):
        user = _make_user(db)
        product = _make_product(db, "SKU-8")
        loc_a = _make_location(db, "WH-A")
        loc_b = _make_location(db, "WH-B")

        inventory.post_journal_entry(
            db, product_id=product.id, user_id=user.id,
            quantity_change=10, movement_type=inventory.RECEIVE, to_location_id=loc_a.id,
        )
        db.commit()

        movements = inventory.transfer_stock(
            db, product_id=product.id, user_id=user.id,
            quantity=4, from_location_id=loc_a.id, to_location_id=loc_b.id,
        )
        db.commit()

        assert [m.movement_type for m in movements] == [inventory.TRANSFER_OUT, inventory.TRANSFER_IN]
        assert inventory.on_hand(db, product_id=product.id, location_id=loc_a.id) == 6
        assert inventory.on_hand(db, product_id=product.id, location_id=loc_b.id) == 4
        assert inventory.on_hand(db, product_id=product.id) == 10

    def test_transfer_same_location_raises(self, db):
        user = _make_user(db)
        product = _make_product(db, "SKU-9")
        loc_a = _make_location(db, "WH-C")

        with pytest.raises(InventoryError, match="must differ"):
            inventory.transfer_stock(
                db, product_id=product.id, user_id=user.id,
                quantity=1, from_location_id=loc_a.id, to_location_id=loc_a.id,
            )

    def test_transfer_with_lot(self, db):
        user = _make_user(db)
        product = _make_product(db, "SKU-10")
        lot = _make_lot(db, product.id, "LOT-X")
        loc_a = _make_location(db, "WH-D")
        loc_b = _make_location(db, "WH-E")

        inventory.post_journal_entry(
            db, product_id=product.id, user_id=user.id,
            quantity_change=5, movement_type=inventory.RECEIVE,
            to_location_id=loc_a.id, lot_id=lot.id,
        )
        db.commit()

        inventory.transfer_stock(
            db, product_id=product.id, user_id=user.id,
            quantity=5, from_location_id=loc_a.id, to_location_id=loc_b.id, lot_id=lot.id,
        )
        db.commit()

        assert inventory.on_hand(db, product_id=product.id, location_id=loc_b.id, lot_id=lot.id) == 5
        assert inventory.on_hand(db, product_id=product.id, location_id=loc_a.id, lot_id=lot.id) == 0


class TestAllocation:
    def test_fefo_picks_soonest_expiry_first(self, db):
        user = _make_user(db)
        product = _make_product(db, "SKU-11")
        loc_a = _make_location(db, "WH-F")
        lot_late = _make_lot(db, product.id, "LOT-L", expiry_date=date(2026, 12, 31))
        lot_soon = _make_lot(db, product.id, "LOT-S", expiry_date=date(2026, 1, 31))

        for lot in (lot_late, lot_soon):
            inventory.post_journal_entry(
                db, product_id=product.id, user_id=user.id,
                quantity_change=5, movement_type=inventory.RECEIVE,
                to_location_id=loc_a.id, lot_id=lot.id,
            )
        db.commit()

        allocation = inventory.allocate_lots(db, product_id=product.id, quantity=6, location_id=loc_a.id)
        assert allocation == [(lot_soon.id, 5), (lot_late.id, 1)]

    def test_fefo_places_no_expiry_last(self, db):
        user = _make_user(db)
        product = _make_product(db, "SKU-12")
        loc_a = _make_location(db, "WH-G")
        lot_no_expiry = _make_lot(db, product.id, "LOT-N")
        lot_soon = _make_lot(db, product.id, "LOT-P", expiry_date=date(2026, 5, 1))

        for lot in (lot_soon, lot_no_expiry):
            inventory.post_journal_entry(
                db, product_id=product.id, user_id=user.id,
                quantity_change=5, movement_type=inventory.RECEIVE,
                to_location_id=loc_a.id, lot_id=lot.id,
            )
        db.commit()

        allocation = inventory.allocate_lots(db, product_id=product.id, quantity=5, location_id=loc_a.id)
        assert allocation == [(lot_soon.id, 5)]

    def test_allocation_insufficient_raises(self, db):
        user = _make_user(db)
        product = _make_product(db, "SKU-13")
        loc_a = _make_location(db, "WH-H")

        inventory.post_journal_entry(
            db, product_id=product.id, user_id=user.id,
            quantity_change=2, movement_type=inventory.RECEIVE, to_location_id=loc_a.id,
        )
        db.commit()

        with pytest.raises(InventoryError, match="Insufficient"):
            inventory.allocate_lots(db, product_id=product.id, quantity=3, location_id=loc_a.id)


class TestSerialized:
    def _serialized_product(self, db):
        product = _make_product(db, "SERIAL-1", is_serialized=True)
        return product

    def test_receive_marks_serial_in_stock(self, db):
        user = _make_user(db)
        product = self._serialized_product(db)
        loc_a = _make_location(db, "WH-I")
        serial = SerialNumber(product_id=product.id, serial_number="SN-0001")
        db.add(serial)
        db.commit()
        db.refresh(serial)

        inventory.post_journal_entry(
            db, product_id=product.id, user_id=user.id,
            quantity_change=1, movement_type=inventory.RECEIVE,
            to_location_id=loc_a.id, serial_id=serial.id,
        )
        db.commit()

        assert serial.status == inventory.SERIAL_STATUS_IN_STOCK
        assert serial.location_id == loc_a.id
        assert inventory.on_hand(db, product_id=product.id) == 1

    def test_sale_marks_serial_sold(self, db):
        user = _make_user(db)
        product = self._serialized_product(db)
        loc_a = _make_location(db, "WH-J")
        serial = SerialNumber(product_id=product.id, serial_number="SN-0002")
        db.add(serial)
        db.commit()
        db.refresh(serial)

        inventory.post_journal_entry(
            db, product_id=product.id, user_id=user.id,
            quantity_change=1, movement_type=inventory.RECEIVE,
            to_location_id=loc_a.id, serial_id=serial.id,
        )
        inventory.post_journal_entry(
            db, product_id=product.id, user_id=user.id,
            quantity_change=-1, movement_type=inventory.SALE,
            from_location_id=loc_a.id, serial_id=serial.id,
            reference_type="sale", reference="INV-200",
        )
        db.commit()

        assert serial.status == inventory.SERIAL_STATUS_SOLD
        assert serial.sold_at is not None
        assert inventory.on_hand(db, product_id=product.id) == 0

    def test_sale_return_restores_serial(self, db):
        user = _make_user(db)
        product = self._serialized_product(db)
        loc_a = _make_location(db, "WH-K")
        serial = SerialNumber(product_id=product.id, serial_number="SN-0003")
        db.add(serial)
        db.commit()
        db.refresh(serial)

        for qty, mtype in ((1, inventory.RECEIVE), (-1, inventory.SALE), (1, inventory.SALE_RETURN)):
            inventory.post_journal_entry(
                db, product_id=product.id, user_id=user.id,
                quantity_change=qty, movement_type=mtype,
                to_location_id=loc_a.id if qty > 0 else None,
                from_location_id=None if qty > 0 else loc_a.id,
                serial_id=serial.id,
            )
        db.commit()

        assert serial.status == inventory.SERIAL_STATUS_IN_STOCK
        assert serial.sold_at is None
        assert inventory.on_hand(db, product_id=product.id) == 1

    def test_serialized_requires_serial_id(self, db):
        user = _make_user(db)
        product = self._serialized_product(db)

        with pytest.raises(InventoryError, match="serial_id"):
            inventory.post_journal_entry(
                db, product_id=product.id, user_id=user.id,
                quantity_change=1, movement_type=inventory.RECEIVE,
            )

    def test_serialized_requires_single_units(self, db):
        user = _make_user(db)
        product = self._serialized_product(db)
        serial = SerialNumber(product_id=product.id, serial_number="SN-0004")
        db.add(serial)
        db.commit()
        db.refresh(serial)

        with pytest.raises(InventoryError, match="one unit at a time"):
            inventory.post_journal_entry(
                db, product_id=product.id, user_id=user.id,
                quantity_change=2, movement_type=inventory.RECEIVE, serial_id=serial.id,
            )

    def test_transfer_moves_serial_location(self, db):
        user = _make_user(db)
        product = self._serialized_product(db)
        loc_a = _make_location(db, "WH-L")
        loc_b = _make_location(db, "WH-M")
        serial = SerialNumber(product_id=product.id, serial_number="SN-0005")
        db.add(serial)
        db.commit()
        db.refresh(serial)

        inventory.post_journal_entry(
            db, product_id=product.id, user_id=user.id,
            quantity_change=1, movement_type=inventory.RECEIVE,
            to_location_id=loc_a.id, serial_id=serial.id,
        )
        db.commit()

        inventory.transfer_stock(
            db, product_id=product.id, user_id=user.id,
            quantity=1, from_location_id=loc_a.id, to_location_id=loc_b.id,
            serial_id=serial.id,
        )
        db.commit()

        assert serial.location_id == loc_b.id
        assert inventory.on_hand(db, product_id=product.id, location_id=loc_a.id) == 0
        assert inventory.on_hand(db, product_id=product.id, location_id=loc_b.id) == 1


class TestParityCache:
    """product.quantity must mirror the ledger balance (sum of stock lines)."""

    def test_cache_updates_without_intermediate_commit(self, db):
        user = _make_user(db)
        product = _make_product(db, "SKU-PAR-1")

        inventory.post_journal_entry(
            db, product_id=product.id, user_id=user.id,
            quantity_change=10, movement_type=inventory.RECEIVE,
        )
        assert db.get(Product, product.id).quantity == 10
        inventory.post_journal_entry(
            db, product_id=product.id, user_id=user.id,
            quantity_change=-4, movement_type=inventory.SALE,
        )
        assert db.get(Product, product.id).quantity == 6
        db.commit()

    def test_cache_matches_ledger_across_mixed_flow(self, db):
        user = _make_user(db)
        product = _make_product(db, "SKU-PAR-2")
        loc_a = _make_location(db, "WH-P1")
        loc_b = _make_location(db, "WH-P2")
        lot = _make_lot(db, product.id, "LOT-P")

        inventory.post_journal_entry(
            db, product_id=product.id, user_id=user.id,
            quantity_change=20, movement_type=inventory.RECEIVE,
            to_location_id=loc_a.id, lot_id=lot.id,
        )
        assert db.get(Product, product.id).quantity == 20

        inventory.transfer_stock(
            db, product_id=product.id, user_id=user.id,
            quantity=5, from_location_id=loc_a.id, to_location_id=loc_b.id, lot_id=lot.id,
        )
        assert db.get(Product, product.id).quantity == 20

        inventory.post_journal_entry(
            db, product_id=product.id, user_id=user.id,
            quantity_change=-8, movement_type=inventory.SALE,
            from_location_id=loc_a.id, lot_id=lot.id,
        )
        assert db.get(Product, product.id).quantity == 12

        inventory.post_journal_entry(
            db, product_id=product.id, user_id=user.id,
            quantity_change=-2, movement_type=inventory.ADJUSTMENT,
            from_location_id=loc_b.id, lot_id=lot.id,
        )
        db.commit()

        assert db.get(Product, product.id).quantity == 10
        assert db.get(Product, product.id).quantity == inventory.on_hand(db, product_id=product.id)


class TestValidation:
    def test_unknown_movement_type_raises(self, db):
        user = _make_user(db)
        product = _make_product(db, "SKU-14")

        with pytest.raises(InventoryError, match="Unknown movement type"):
            inventory.post_journal_entry(
                db, product_id=product.id, user_id=user.id,
                quantity_change=1, movement_type="teleport",
            )

    def test_zero_quantity_change_raises(self, db):
        user = _make_user(db)
        product = _make_product(db, "SKU-15")

        with pytest.raises(InventoryError, match="non-zero"):
            inventory.post_journal_entry(
                db, product_id=product.id, user_id=user.id,
                quantity_change=0, movement_type=inventory.RECEIVE,
            )

    def test_unknown_location_raises(self, db):
        user = _make_user(db)
        product = _make_product(db, "SKU-16")

        with pytest.raises(InventoryError, match="location does not exist"):
            inventory.post_journal_entry(
                db, product_id=product.id, user_id=user.id,
                quantity_change=1, movement_type=inventory.RECEIVE,
                to_location_id=99999,
            )

    def test_unknown_product_raises(self, db):
        user = _make_user(db)

        with pytest.raises(InventoryError, match="Product not found"):
            inventory.post_journal_entry(
                db, product_id=99999, user_id=user.id,
                quantity_change=1, movement_type=inventory.RECEIVE,
            )

    def test_negative_allocation_raises(self, db):
        user = _make_user(db)
        product = _make_product(db, "SKU-17")

        with pytest.raises(InventoryError, match="non-negative"):
            inventory.allocate_lots(db, product_id=product.id, quantity=-1)
