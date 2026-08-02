from sqlalchemy import Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class DocumentSequence(Base):
    __tablename__ = "document_sequences"

    name: Mapped[str] = mapped_column(String(50), primary_key=True)
    next_value: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
