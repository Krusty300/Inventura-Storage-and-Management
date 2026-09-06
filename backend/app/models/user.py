from datetime import datetime

from sqlalchemy import JSON, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.types import UTCDateTime


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(20), default="worker")
    permissions: Mapped[list | None] = mapped_column(JSON, nullable=True)
    is_active: Mapped[bool] = mapped_column(default=True)
    is_approved: Mapped[bool] = mapped_column(default=False)
    avatar_url: Mapped[str] = mapped_column(String(500), default="")
    dashboard_widgets: Mapped[list | None] = mapped_column(JSON, nullable=True)
    last_login_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, server_default=func.now(), onupdate=func.now())

    stock_movements = relationship("StockMovement", back_populates="user")
    orders = relationship("Order", back_populates="user")
    sales = relationship("Sale", back_populates="user")
    notifications = relationship("Notification", back_populates="user", cascade="all, delete-orphan")
    attachments = relationship("Attachment", foreign_keys="Attachment.uploaded_by", back_populates="uploader")
