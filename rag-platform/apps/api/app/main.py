"""API service entrypoint."""

from contextlib import asynccontextmanager

from fastapi import FastAPI

from apps.api.app.api.v1.ingestion import router as ingestion_router
from apps.api.app.api.v1.query import router as query_router
from libs.observability.api import create_observability_app


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(title="RAG Platform API", lifespan=lifespan)
app.include_router(ingestion_router)
app.include_router(query_router)

_obs_app = create_observability_app()
for route in _obs_app.routes:
    app.routes.append(route)
