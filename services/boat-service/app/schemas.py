from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    # JSON en camelCase
    model_config = ConfigDict(
        alias_generator=to_camel,
        validate_by_name=True,
        validate_by_alias=True,
        serialize_by_alias=True,
        str_strip_whitespace=True,
    )


class BoatType(StrEnum):
    VOILIER = "voilier"
    CATAMARAN = "catamaran"
    YACHT = "yacht"
    SEMI_RIGIDE = "semi-rigide"
    MOTEUR = "moteur"


BOAT_TYPE_LABELS = {
    BoatType.VOILIER: "Voilier",
    BoatType.CATAMARAN: "Catamaran",
    BoatType.YACHT: "Yacht",
    BoatType.SEMI_RIGIDE: "Semi-rigide",
    BoatType.MOTEUR: "Bateau à moteur",
}


class Port(CamelModel):
    id: int
    name: str
    city: str


class BoatTypeOut(BaseModel):
    value: BoatType
    label: str


class Boat(CamelModel):
    id: int
    name: str
    type: BoatType
    port: Port
    capacity: int
    length_m: float
    price_per_day: float
    license_required: bool
    description: str


class BoatIn(CamelModel):
    name: str = Field(min_length=2, max_length=60)
    type: BoatType
    port_id: int = Field(gt=0)
    capacity: int = Field(ge=1, le=50)
    length_m: float = Field(gt=0, le=100)
    price_per_day: float = Field(gt=0, le=100_000)
    license_required: bool = True
    description: str = Field(default="", max_length=500)
