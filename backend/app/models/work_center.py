from datetime import datetime

from sqlalchemy import JSON, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.mixins import SoftDeleteMixin
from app.models.types import UTCDateTime

WORK_CENTER_TYPES = ("workstation", "machine", "labor", "outsourced")

DEFAULT_WORKING_DAYS = [0, 1, 2, 3, 4]


class WorkCenter(SoftDeleteMixin, Base):
    """A capacity-constrained resource a product can be routed through.

    A work center is anything that limits how fast production can run: a
    machine, a workstation, a team of operators, or a third-party supplier.
    Capacity planning needs two things from it - how many minutes it offers on
    a given day (``hours_per_day`` restricted to ``working_days``) and how
    efficiently it converts ideal time into real time (``efficiency``). A
    routing then claims chunks of that capacity per operation.
    """

    __tablename__ = "work_centers"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    work_center_type: Mapped[str] = mapped_column(String(30), default="workstation", index=True)
    location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"), nullable=True, index=True)
    hours_per_day: Mapped[float] = mapped_column(Numeric(6, 2), default=8.0)
    # ISO weekday numbers (0 = Monday .. 6 = Sunday) the center is available on.
    working_days: Mapped[list | None] = mapped_column(JSON, nullable=True)
    shift_start: Mapped[str] = mapped_column(String(5), default="08:00")
    efficiency: Mapped[float] = mapped_column(Numeric(6, 2), default=100.0)
    hourly_rate: Mapped[float] = mapped_column(Numeric(10, 2), default=0.0)
    notes: Mapped[str] = mapped_column(Text, default="")
    is_active: Mapped[bool] = mapped_column(default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now(), onupdate=func.now())

    location = relationship("Location")
    routing_operations = relationship("RoutingOperation", back_populates="work_center")
    work_orders = relationship("WorkOrder", back_populates="work_center")

    @property
    def location_name(self) -> str:
        return self.location.path if self.location else ""

    @property
    def working_day_list(self) -> list[int]:
        days = self.working_days
        if not isinstance(days, list):
            return list(DEFAULT_WORKING_DAYS)
        return [int(d) for d in days if isinstance(d, int) and 0 <= d <= 6]

    @property
    def daily_minutes(self) -> int:
        return int(round(float(self.hours_per_day or 0) * 60))

    @property
    def is_available(self) -> bool:
        """Whether this center offers any capacity at all."""
        return bool(self.is_active and not self.is_deleted and self.daily_minutes > 0)


class RoutingOperation(Base):
    """One step in a product's routing, claiming time on a work center.

    Standard time for the step is ``setup_minutes + run_minutes_per_unit *
    quantity``, so a routing can price and schedule a work order before anyone
    has recorded what it actually took. ``position`` is the sequence the step
    runs in and is unique per product so the order is unambiguous.
    """

    __tablename__ = "routing_operations"
    __table_args__ = (
        UniqueConstraint("product_id", "position", name="uq_routing_operations_product_position"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)
    work_center_id: Mapped[int] = mapped_column(ForeignKey("work_centers.id"), nullable=False, index=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    name: Mapped[str] = mapped_column(String(200), default="")
    setup_minutes: Mapped[int] = mapped_column(Integer, default=0)
    run_minutes_per_unit: Mapped[float] = mapped_column(Numeric(10, 4), default=0.0)
    notes: Mapped[str] = mapped_column(Text, default="")
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now())

    product = relationship("Product", back_populates="routing_operations")
    work_center = relationship("WorkCenter", back_populates="routing_operations")

    @property
    def product_name(self) -> str:
        return self.product.display_name if self.product else ""

    @property
    def work_center_name(self) -> str:
        return self.work_center.name if self.work_center else ""

    @property
    def work_center_code(self) -> str:
        return self.work_center.code if self.work_center else ""

    @property
    def label(self) -> str:
        return self.name or self.work_center_name

    def standard_minutes(self, quantity: int) -> float:
        """Ideal minutes this step needs to process ``quantity`` units."""
        return float(self.setup_minutes or 0) + float(self.run_minutes_per_unit or 0) * max(int(quantity), 0)