from datetime import datetime

from pydantic import BaseModel, ConfigDict


class NoteTagOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    color: str


class NoteTagCreate(BaseModel):
    name: str
    color: str = "#6366f1"


class NoteLinkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    entity_type: str
    entity_id: int


class NoteLinkCreate(BaseModel):
    entity_type: str
    entity_id: int


class NoteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    body: str
    category: str
    priority: str
    is_pinned: bool
    is_completed: bool
    is_archived: bool = False
    due_date: datetime | None
    recurrence: str
    recurrence_end: datetime | None
    sort_order: int
    image_url: str = ""
    user_id: int
    assigned_to_id: int | None
    created_at: datetime
    updated_at: datetime
    username: str = ""
    assigned_to_name: str | None = None
    tags: list[NoteTagOut] = []
    links: list[NoteLinkOut] = []


class NoteCreate(BaseModel):
    title: str
    body: str = ""
    category: str = "note"
    priority: str = "normal"
    is_pinned: bool = False
    due_date: datetime | None = None
    recurrence: str = "none"
    recurrence_end: datetime | None = None
    assigned_to_id: int | None = None
    tag_ids: list[int] = []
    links: list[NoteLinkCreate] = []


class NoteUpdate(BaseModel):
    title: str | None = None
    body: str | None = None
    category: str | None = None
    priority: str | None = None
    is_pinned: bool | None = None
    is_completed: bool | None = None
    is_archived: bool | None = None
    due_date: datetime | None = None
    recurrence: str | None = None
    recurrence_end: datetime | None = None
    sort_order: int | None = None
    image_url: str | None = None
    assigned_to_id: int | None = None
    tag_ids: list[int] | None = None


class NoteAssign(BaseModel):
    assigned_to_id: int | None = None


class NoteTemplateCreate(BaseModel):
    name: str
    category: str = "note"
    priority: str = "normal"
    body: str = ""
    recurrence: str = "none"


class NoteTemplateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    category: str
    priority: str
    body: str
    recurrence: str
    user_id: int
    created_at: datetime
