from fastapi import FastAPI

from app.api.auth import router as auth_router

app = FastAPI(title="AMA LMS API")
app.include_router(auth_router, prefix="/api")
