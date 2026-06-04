"""API service entrypoint."""

from fastapi import FastAPI

from apps.api.app.api.v1.ingestion import router as ingestion_router


app = FastAPI(title="RAG Platform API")
app.include_router(ingestion_router)
