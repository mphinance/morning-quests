"""Morning Quests API — FastAPI backend for server-side state persistence."""
import json
from pathlib import Path
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)

app = FastAPI(title="Morning Quests API")


def state_file(profile_id: str = "default") -> Path:
    """Get the state file path for a profile. Sanitize to prevent path traversal."""
    safe = "".join(c for c in str(profile_id) if c.isalnum() or c in "-_")
    return DATA_DIR / f"state_{safe or 'default'}.json"


@app.get("/api/state")
async def get_state():
    """Load the full app state from disk."""
    f = state_file()
    if f.exists():
        return JSONResponse(json.loads(f.read_text()))
    return JSONResponse(None, status_code=204)


@app.put("/api/state")
async def put_state(body: dict):
    """Save the full app state to disk."""
    f = state_file()
    f.write_text(json.dumps(body, indent=2))
    return {"ok": True}


@app.get("/api/health")
async def health():
    return {"status": "ok", "data_dir": str(DATA_DIR)}


# Serve index.html at root
@app.get("/")
async def root():
    return FileResponse(Path(__file__).parent / "index.html")


# Serve static files (CSS, JS, icons, etc.)
app.mount("/", StaticFiles(directory=Path(__file__).parent), name="static")
