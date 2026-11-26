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
    settings: Mapped[dict] = mapped_column(JSON, default=dict)
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
    placeable: Mapped[bool] = mapped_column(Boolean, default=True)
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
    code: Mapped[str | None] = mapped_column(String(60), nullable=True, index=True)  # stable key for BOQ rules
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
    serving_rack_id: Mapped[int | None] = mapped_column(Integer, nullable=True)  # placement id of a rack
    layout: Mapped[Layout] = relationship(back_populates="placements")
    item: Mapped[CatalogueItem] = relationship()


class Annotation(Base):
    __tablename__ = "annotation"
    id: Mapped[int] = mapped_column(primary_key=True)
    layout_id: Mapped[int] = mapped_column(ForeignKey("layout.id", ondelete="CASCADE"))
    x: Mapped[float] = mapped_column(Float)
    y: Mapped[float] = mapped_column(Float)
    text: Mapped[str] = mapped_column(Text)


# ---------------- Phase 2-4 ----------------
class Route(Base):
    """A drawn cable route / tray / conduit polyline on a layout (image px)."""
    __tablename__ = "route"
    id: Mapped[int] = mapped_column(primary_key=True)
    layout_id: Mapped[int] = mapped_column(ForeignKey("layout.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(20))  # cat6, cat6a, fiber, tray, conduit
    points: Mapped[list] = mapped_column(JSON)  # [x1,y1,x2,y2,...]
    vertical_m: Mapped[float] = mapped_column(Float, default=0)
    label: Mapped[str] = mapped_column(String(100), default="")


class QuantityOverride(Base):
    __tablename__ = "quantity_override"
    __table_args__ = (UniqueConstraint("project_id", "key"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("project.id", ondelete="CASCADE"))
    key: Mapped[str] = mapped_column(String(80))
    value: Mapped[float] = mapped_column(Float)
    reason: Mapped[str] = mapped_column(Text, default="")


class PortOverride(Base):
    __tablename__ = "port_override"
    __table_args__ = (UniqueConstraint("project_id", "placement_id", "point_index"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("project.id", ondelete="CASCADE"))
    placement_id: Mapped[int] = mapped_column(ForeignKey("placement.id", ondelete="CASCADE"))
    point_index: Mapped[int] = mapped_column(Integer)
    data: Mapped[dict] = mapped_column(JSON)  # rack_id, switch_no, switch_port, pp_no, pp_port, vlan, destination, remarks


class BoqLine(Base):
    """User edits to generated BOQ lines (is_manual=False, keyed) or manual extra lines (is_manual=True)."""
    __tablename__ = "boq_line"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("project.id", ondelete="CASCADE"))
    key: Mapped[str] = mapped_column(String(120))
    is_manual: Mapped[bool] = mapped_column(Boolean, default=False)
    data: Mapped[dict] = mapped_column(JSON)  # any of: section, description, specs, brand, model, uom, qty, phase1, rate, gst_pct, install_rate, remarks, hidden


# ---------------- Phase 5 ----------------
class VendorQuote(Base):
    __tablename__ = "vendor_quote"
    id: Mapped[int] = mapped_column(primary_key=True)
    catalogue_item_id: Mapped[int] = mapped_column(ForeignKey("catalogue_item.id", ondelete="CASCADE"))
    vendor: Mapped[str] = mapped_column(String(120))
    rate: Mapped[float] = mapped_column(Float)
    quote_ref: Mapped[str] = mapped_column(String(120), default="")
    quote_date: Mapped[str] = mapped_column(String(20), default="")


class Snapshot(Base):
    __tablename__ = "snapshot"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("project.id", ondelete="CASCADE"))
    label: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    summary: Mapped[dict] = mapped_column(JSON)
    data: Mapped[dict] = mapped_column(JSON)
