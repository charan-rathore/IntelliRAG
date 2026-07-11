"""API service entrypoint."""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from apps.api.app.api.v1.ingestion import router as ingestion_router
from apps.api.app.api.v1.query import router as query_router
from libs.observability.api import create_observability_app

STATIC_DIR = Path(__file__).resolve().parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(title="RAG Platform API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(ingestion_router)
app.include_router(query_router)

_obs_app = create_observability_app()
for route in _obs_app.routes:
    app.routes.append(route)

if STATIC_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR), name="assets")

    @app.get("/", include_in_schema=False)
    def serve_ui() -> FileResponse:
        """Serve the IntelliRAG query console."""
        return FileResponse(STATIC_DIR / "index.html")
