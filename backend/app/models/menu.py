from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.types import UTCDateTime


class MenuSection(Base):
    __tablename__ = "menu_sections"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now(), onupdate=func.now())

    products = relationship("Product", back_populates="menu_section")

    @property
    def item_count(self) -> int:
        return sum(1 for p in self.products if p.is_active and p.is_menu_item)


class MenuModifierGroup(Base):
    __tablename__ = "menu_modifier_groups"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    min_select: Mapped[int] = mapped_column(Integer, default=0)
    max_select: Mapped[int] = mapped_column(Integer, default=1)
    is_required: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now(), onupdate=func.now())

    product = relationship("Product", back_populates="modifier_groups")
    options = relationship(
        "MenuModifierOption",
        back_populates="group",
        cascade="all, delete-orphan",
        order_by="MenuModifierOption.sort_order",
    )

    @property
    def option_count(self) -> int:
        return len(self.options)


class MenuModifierOption(Base):
    __tablename__ = "menu_modifier_options"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    group_id: Mapped[int] = mapped_column(ForeignKey("menu_modifier_groups.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    price_delta: Mapped[float] = mapped_column(Numeric(10, 2), default=0.0)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now())

    group = relationship("MenuModifierGroup", back_populates="options")