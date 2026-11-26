from datetime import datetime, timezone
from sqlalchemy import String, Integer, Float, ForeignKey, DateTime, Text, Boolean, JSON, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .db import Base


def now():
    return datetime.now(timezone.utc)


class Project(Base):
    __tablename__ = "project"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    client: Mapped[str] = mapped_column(String(200), default="")
    location: Mapped[str] = mapped_column(String(200), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    num_buildings: Mapped[int] = mapped_column(Integer, default=1)
    num_floors: Mapped[int] = mapped_column(Integer, default=1)
    phase: Mapped[str] = mapped_column(String(50), default="Planning")
    status: Mapped[str] = mapped_column(String(50), default="Draft")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    buildings: Mapped[list["Building"]] = relationship(
        back_populates="project", cascade="all, delete-orphan", order_by="Building.sort"
    )


class Building(Base):
    __tablename__ = "building"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("project.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(200))
    code: Mapped[str] = mapped_column(String(20))
    sort: Mapped[int] = mapped_column(Integer, default=0)
    project: Mapped[Project] = relationship(back_populates="buildings")
    floors: Mapped[list["Floor"]] = relationship(
        back_populates="building", cascade="all, delete-orphan", order_by="Floor.level"
    )


class Floor(Base):
    __tablename__ = "floor"
    id: Mapped[int] = mapped_column(primary_key=True)
    building_id: Mapped[int] = mapped_column(ForeignKey("building.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(200))
    code: Mapped[str] = mapped_column(String(20))
    level: Mapped[int] = mapped_column(Integer, default=0)
    building: Mapped[Building] = relationship(back_populates="floors")
    layouts: Mapped[list["Layout"]] = relationship(
        back_populates="floor", cascade="all, delete-orphan", order_by="Layout.id"
    )


class Layout(Base):
    __tablename__ = "layout"
    id: Mapped[int] = mapped_column(primary_key=True)
    floor_id: Mapped[int] = mapped_column(ForeignKey("floor.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(200))
    file_type: Mapped[str] = mapped_column(String(10))
    original_name: Mapped[str] = mapped_column(String(300))
    original_path: Mapped[str] = mapped_column(String(500))
    image_path: Mapped[str] = mapped_column(String(500))
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    scale_m_per_px: Mapped[float | None] = mapped_column(Float, nullable=True)
    layers: Mapped[dict] = mapped_column(JSON, default=dict)  # {layer: {visible, locked}}
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)
    floor: Mapped[Floor] = relationship(back_populates="layouts")
    placements: Mapped[list["Placement"]] = relationship(
        back_populates="layout", cascade="all, delete-orphan", order_by="Placement.id"
    )


class CatalogueCategory(Base):
    __tablename__ = "catalogue_category"
    id: Mapped[int] = mapped_column(primary_key=True)
    group: Mapped[str] = mapped_column(String(100))  # Networking, CCTV, ...
    name: Mapped[str] = mapped_column(String(100))
    layer: Mapped[str] = mapped_column(String(50))
    symbol: Mapped[str] = mapped_column(String(10))  # used in equipment IDs
    color: Mapped[str] = mapped_column(String(10))
    point_type: Mapped[str] = mapped_column(String(30), default="")  # Data/Voice/CCTV/Wi-Fi/...
    ports_required: Mapped[int] = mapped_column(Integer, default=0)
    sort: Mapped[int] = mapped_column(Integer, default=0)
    items: Mapped[list["CatalogueItem"]] = relationship(back_populates="category", order_by="CatalogueItem.id")


class CatalogueItem(Base):
    __tablename__ = "catalogue_item"
    id: Mapped[int] = mapped_column(primary_key=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("catalogue_category.id"))
    manufacturer: Mapped[str] = mapped_column(String(100), default="Generic")
    model: Mapped[str] = mapped_column(String(100), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    specs: Mapped[str] = mapped_column(Text, default="")
    uom: Mapped[str] = mapped_column(String(20), default="Nos.")
    indicative_rate: Mapped[float] = mapped_column(Float, default=0)  # ex-GST
    vendor_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    gst_pct: Mapped[float] = mapped_column(Float, default=18)
    warranty: Mapped[str] = mapped_column(String(50), default="")
    datasheet_url: Mapped[str] = mapped_column(String(500), default="")
    install_rate: Mapped[float] = mapped_column(Float, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    category: Mapped[CatalogueCategory] = relationship(back_populates="items")


class IdCounter(Base):
    """Equipment-ID counters, so a deleted ID is never handed out again."""
    __tablename__ = "id_counter"
    __table_args__ = (UniqueConstraint("project_id", "prefix"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("project.id", ondelete="CASCADE"))
    prefix: Mapped[str] = mapped_column(String(60))
    last: Mapped[int] = mapped_column(Integer, default=0)


class Placement(Base):
    __tablename__ = "placement"
    id: Mapped[int] = mapped_column(primary_key=True)
    layout_id: Mapped[int] = mapped_column(ForeignKey("layout.id", ondelete="CASCADE"))
    equip_code: Mapped[str] = mapped_column(String(60), index=True)  # unique per project via IdCounter
    catalogue_item_id: Mapped[int] = mapped_column(ForeignKey("catalogue_item.id"))
    x: Mapped[float] = mapped_column(Float)
    y: Mapped[float] = mapped_column(Float)
    rotation: Mapped[float] = mapped_column(Float, default=0)
    room: Mapped[str] = mapped_column(String(200), default="")
    phase: Mapped[str] = mapped_column(String(20), default="Phase 1")
    ports: Mapped[int] = mapped_column(Integer, default=0)
    remarks: Mapped[str] = mapped_column(Text, default="")
    source: Mapped[str] = mapped_column(String(20), default="manual")
    layout: Mapped[Layout] = relationship(back_populates="placements")
    item: Mapped[CatalogueItem] = relationship()


class Annotation(Base):
    __tablename__ = "annotation"
    id: Mapped[int] = mapped_column(primary_key=True)
    layout_id: Mapped[int] = mapped_column(ForeignKey("layout.id", ondelete="CASCADE"))
    x: Mapped[float] = mapped_column(Float)
    y: Mapped[float] = mapped_column(Float)
    text: Mapped[str] = mapped_column(Text)
