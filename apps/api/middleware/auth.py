from fastapi import Depends, HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from core.config import settings
from dataclasses import dataclass

security = HTTPBearer()


@dataclass
class CurrentUser:
    user_id: str
    hotel_id: str
    role: str
    email: str = ""


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Security(security)
) -> CurrentUser:
    token = credentials.credentials
    try:
        payload = jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience="authenticated"
        )
        user_id = payload.get("sub")
        hotel_id = payload.get("hotel_id")
        role = payload.get("role", "none")

        if not user_id or not hotel_id:
            raise HTTPException(status_code=401, detail="Invalid token claims")

        return CurrentUser(
            user_id=user_id,
            hotel_id=hotel_id,
            role=role,
            email=payload.get("email", "")
        )
    except JWTError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {str(e)}")


def require_role(*roles: str):
    """Role-based access control dependency."""
    async def check_role(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if current_user.role not in roles:
            raise HTTPException(
                status_code=403,
                detail=f"Role '{current_user.role}' is not authorized for this action"
            )
        return current_user
    return check_role


def require_cron(x_cron_secret: str = None):
    """Validates internal cron job requests."""
    if x_cron_secret != settings.cron_secret:
        raise HTTPException(status_code=401, detail="Invalid cron secret")
