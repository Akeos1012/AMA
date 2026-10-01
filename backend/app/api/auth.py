from typing import Any, Callable

import firebase_admin
from firebase_admin import auth as firebase_auth
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

router = APIRouter()
bearer_scheme = HTTPBearer(auto_error=False)


def verify_firebase_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict[str, Any]:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=401,
            detail="Missing bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        app = firebase_admin.get_app()
    except ValueError:
        try:
            app = firebase_admin.initialize_app()
        except ValueError:
            app = firebase_admin.get_app()

    try:
        decoded_token = firebase_auth.verify_id_token(
            credentials.credentials,
            app=app,
            check_revoked=False,
        )
    except (firebase_auth.InvalidIdTokenError, firebase_auth.ExpiredIdTokenError):
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired Firebase ID token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from None

    if not decoded_token.get("uid"):
        raise HTTPException(status_code=401, detail="Invalid Firebase ID token")

    return decoded_token


def require_role(required_role: str) -> Callable[..., dict[str, Any]]:
    def verify_role(
        decoded_token: dict[str, Any] = Depends(verify_firebase_token),
    ) -> dict[str, Any]:
        if decoded_token.get("role") != required_role:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return decoded_token

    return verify_role


@router.get("/auth/me")
def read_current_user(
    decoded_token: dict[str, Any] = Depends(verify_firebase_token),
) -> dict[str, Any]:
    return {"uid": decoded_token["uid"], "role": decoded_token.get("role")}
