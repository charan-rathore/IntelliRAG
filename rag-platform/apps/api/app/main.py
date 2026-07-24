"""API service entrypoint."""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from apps.api.app.api.v1.ingestion import router as ingestion_router
from apps.api.app.api.v1.query import router as query_router
from apps.api.app.services.query.sources import get_source
from libs.observability.api import create_observability_app

STATIC_DIR = Path(__file__).resolve().parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Warm query pipeline / Ollama in background so first chat is faster.
    try:
        from apps.api.app.services.query.service import QueryService

        QueryService.get()._ensure_pipeline()
    except Exception:
        pass
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


@app.get("/sources/{doc_id}", include_in_schema=False)
def serve_source_document(doc_id: str) -> HTMLResponse:
    """Human-readable source document page for citation links."""
    source = get_source(doc_id)
    if source is None:
        raise HTTPException(status_code=404, detail=f"Unknown source: {doc_id}")
    from html import escape

    body = escape(source["content"])
    title = escape(source["title"])
    html = f"""<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>{title} · IntelliRAG</title>
<style>
  body {{ margin:0; font-family: Georgia, serif; background:#f3efe6; color:#12171c; }}
  header {{ padding:1rem 1.4rem; border-bottom:1px solid #d9d2c4; background:#faf7f0; }}
  a {{ color:#1f6f5b; }}
  main {{ max-width:720px; margin:0 auto; padding:1.5rem 1.2rem 3rem; }}
  pre {{ white-space:pre-wrap; font-family:ui-monospace,Menlo,monospace; font-size:0.92rem;
         line-height:1.55; background:#faf7f0; padding:1rem; border-radius:12px;
         border:1px solid #d9d2c4; }}
</style></head>
<body>
<header><a href="/">← IntelliRAG</a> · Source</header>
<main>
  <h1>{title}</h1>
  <p><code>{escape(source['doc_id'])}</code> · <a href="{escape(source['url'])}">{escape(source['url'])}</a></p>
  <pre>{body}</pre>
</main>
</body></html>"""
    return HTMLResponse(html)


if STATIC_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR), name="assets")

    @app.get("/", include_in_schema=False)
    def serve_ui() -> FileResponse:
        """Serve the IntelliRAG query console."""
        return FileResponse(STATIC_DIR / "index.html")
