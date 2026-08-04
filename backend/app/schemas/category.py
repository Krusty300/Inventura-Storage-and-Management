from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class CategoryCreate(BaseModel):
    name: str
    description: str = ""
    parent_id: Optional[int] = None


class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    parent_id: Optional[int] = None


class CategoryBulkEdit(BaseModel):
    ids: list[int]
    description: Optional[str] = None
    parent_id: Optional[int] = None


class CategoryOut(BaseModel):
    id: int
    name: str
    description: str
    parent_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class CategoryTree(CategoryOut):
    subcategories: list["CategoryTree"] = []
