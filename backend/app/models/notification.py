from datetime import datetime, timezone

from sqlalchemy import Column, Integer, String, Boolean, ForeignKey
from sqlalchemy.orm import relationship

from app.database import Base
from app.models.types import UTCDateTime


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    type = Column(String(50), default="info")
    title = Column(String(200), nullable=False)
    message = Column(String(500), default="")
    link = Column(String(200), default="")
    is_read = Column(Boolean, default=False)
    created_at = Column(UTCDateTime, default=datetime.now(timezone.utc))

    user = relationship("User", back_populates="notifications")
