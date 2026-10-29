import firebase_admin
from firebase_admin import credentials
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import router as auth_router
from app.api.admin_users import router as admin_users_router
from app.api.admin_subjects import router as admin_subjects_router
from app.api.admin_classes import router as admin_classes_router
from app.api.admin_classes import teacher_router as teacher_classes_router
from app.api.lessons import router as lessons_router

from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
cred = credentials.Certificate(BASE_DIR / "firebase-service-account.json")

if not firebase_admin._apps:
    firebase_admin.initialize_app(cred)


app = FastAPI(title="AMA LMS API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:5500",
        "http://localhost:5500",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api")
app.include_router(admin_users_router, prefix="/api")
app.include_router(admin_subjects_router, prefix="/api")
app.include_router(admin_classes_router, prefix="/api")
app.include_router(teacher_classes_router, prefix="/api")
app.include_router(lessons_router, prefix="/api")
