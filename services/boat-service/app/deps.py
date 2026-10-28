from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request

from app.repository import BoatRepository


def get_repo(request: Request) -> BoatRepository:
    return request.app.state.repo


Repo = Annotated[BoatRepository, Depends(get_repo)]


def require_admin(x_user_role: Annotated[str | None, Header()] = None) -> None:
    # posé par nginx, la valeur envoyée par le client est écrasée
    if x_user_role != "admin":
        raise HTTPException(status_code=403, detail="Réservé aux administrateurs")
