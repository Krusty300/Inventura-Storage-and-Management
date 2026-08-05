from datetime import datetime

from sqlalchemy import ForeignKey, Integer, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.types import UTCDateTime


class LotLink(Base):
    """Parent->child link between lots (manufacturing genealogy).

    A link is created when a work order consumes stock from ``parent_lot_id``
    and produces the finished-good lot ``child_lot_id``. ``quantity`` is the
    amount of the parent lot consumed.
    """

    __tablename__ = "lot_links"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    parent_lot_id: Mapped[int] = mapped_column(ForeignKey("lots.id"), nullable=False, index=True)
    child_lot_id: Mapped[int] = mapped_column(ForeignKey("lots.id"), nullable=False, index=True)
    work_order_id: Mapped[int | None] = mapped_column(ForeignKey("work_orders.id"), nullable=True, index=True)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now())

    parent = relationship("Lot", foreign_keys=[parent_lot_id], back_populates="child_links")
    child = relationship("Lot", foreign_keys=[child_lot_id], back_populates="parent_links")
    work_order = relationship("WorkOrder")
