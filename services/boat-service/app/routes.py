from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response

from app.deps import Repo, require_admin
from app.schemas import BOAT_TYPE_LABELS, Boat, BoatIn, BoatType, BoatTypeOut, Port

router = APIRouter(prefix="/api/boats", tags=["boats"])

BoatId = Annotated[int, Path(gt=0)]
NOT_FOUND = "Bateau introuvable"


@router.get("", response_model=list[Boat])
def list_boats(
    repo: Repo,
    port: Annotated[int | None, Query(gt=0, description="Identifiant du port")] = None,
    boat_type: Annotated[BoatType | None, Query(alias="type")] = None,
    min_capacity: Annotated[int | None, Query(alias="minCapacity", ge=1)] = None,
    max_price: Annotated[float | None, Query(alias="maxPrice", gt=0)] = None,
):
    return repo.list_boats(port_id=port, boat_type=boat_type, min_capacity=min_capacity, max_price=max_price)


# avant /{boat_id}, sinon "ports" serait lu comme un id
@router.get("/ports", response_model=list[Port])
def list_ports(repo: Repo):
    return repo.list_ports()


@router.get("/types", response_model=list[BoatTypeOut])
def list_types():
    return [{"value": t, "label": label} for t, label in BOAT_TYPE_LABELS.items()]


@router.get("/{boat_id}", response_model=Boat)
def get_boat(boat_id: BoatId, repo: Repo):
    boat = repo.get_boat(boat_id)
    if boat is None:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    return boat


@router.post("", response_model=Boat, status_code=201, dependencies=[Depends(require_admin)])
def create_boat(payload: BoatIn, repo: Repo):
    if not repo.port_exists(payload.port_id):
        raise HTTPException(status_code=422, detail="Port inconnu")
    return repo.create_boat(payload.model_dump(by_alias=False))


@router.put("/{boat_id}", response_model=Boat, dependencies=[Depends(require_admin)])
def update_boat(boat_id: BoatId, payload: BoatIn, repo: Repo):
    if not repo.port_exists(payload.port_id):
        raise HTTPException(status_code=422, detail="Port inconnu")
    boat = repo.update_boat(boat_id, payload.model_dump(by_alias=False))
    if boat is None:
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    return boat


@router.delete("/{boat_id}", status_code=204, dependencies=[Depends(require_admin)])
def delete_boat(boat_id: BoatId, repo: Repo):
    if not repo.delete_boat(boat_id):
        raise HTTPException(status_code=404, detail=NOT_FOUND)
    return Response(status_code=204)
