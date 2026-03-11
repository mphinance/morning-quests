"""Morning Quests API — FastAPI backend for server-side state persistence."""
import json
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)

ROBUX_TO_USD = 9.99 / 800
MC_PER_ROBUX = (320 / 1.99) / (800 / 9.99)

app = FastAPI(
    title="Morning Quests API",
    description="Gamified morning routine tracker for kids. Query quest status, streaks, bank balances, and history.",
    version="2.0.0",
)


def state_file(profile_id: str = "default") -> Path:
    safe = "".join(c for c in str(profile_id) if c.isalnum() or c in "-_")
    return DATA_DIR / f"state_{safe or 'default'}.json"


def load() -> Optional[dict]:
    f = state_file()
    if f.exists():
        return json.loads(f.read_text())
    return None


def get_profile(s: dict, profile_id: Optional[int] = None) -> dict:
    if profile_id is not None:
        p = next((p for p in s["profiles"] if p["id"] == profile_id), None)
        if not p:
            raise HTTPException(404, f"Profile {profile_id} not found")
        return p
    return next((p for p in s["profiles"] if p["id"] == s["activeProfileId"]), s["profiles"][0])


# ─── Raw state ───────────────────────────────────────────────

@app.get("/api/state", tags=["State"])
async def get_state():
    """Load the full app state from disk."""
    s = load()
    if s:
        return JSONResponse(s)
    return JSONResponse(None, status_code=204)


@app.put("/api/state", tags=["State"])
async def put_state(body: dict):
    """Save the full app state to disk."""
    f = state_file()
    f.write_text(json.dumps(body, indent=2))
    return {"ok": True}


# ─── Today ───────────────────────────────────────────────────

@app.get("/api/today", tags=["Quests"])
async def today_status(profile_id: Optional[int] = None):
    """Get today's quest status for a profile. Shows each quest and whether it's done."""
    s = load()
    if not s:
        raise HTTPException(404, "No state saved yet")
    p = get_profile(s, profile_id)
    quests = []
    for q in p["quests"]:
        quests.append({
            "id": q["id"],
            "name": q["name"],
            "icon": q["icon"],
            "xp": q["xp"],
            "timer_seconds": q.get("timer", 0),
            "completed": q["id"] in p["today"].get("completed", {}),
        })
    done = sum(1 for q in quests if q["completed"])
    return {
        "profile": p["name"],
        "date": p["today"]["date"],
        "approved": p["today"].get("approved", False),
        "quests_done": done,
        "quests_total": len(quests),
        "all_done": done == len(quests),
        "quests": quests,
    }


@app.get("/api/today/{quest_id}", tags=["Quests"])
async def quest_status(quest_id: str, profile_id: Optional[int] = None):
    """Check if a specific quest is done today. E.g. GET /api/today/teeth → did they brush?"""
    s = load()
    if not s:
        raise HTTPException(404, "No state saved yet")
    p = get_profile(s, profile_id)
    q = next((q for q in p["quests"] if q["id"] == quest_id), None)
    if not q:
        available = [q["id"] for q in p["quests"]]
        raise HTTPException(404, f"Quest '{quest_id}' not found. Available: {available}")
    done = quest_id in p["today"].get("completed", {})
    return {
        "profile": p["name"],
        "quest": q["name"],
        "icon": q["icon"],
        "completed": done,
        "answer": f"{'Yes' if done else 'No'} — {p['name']} {'did' if done else 'did NOT'} {q['name'].lower()} today.",
    }


# ─── Profile summary ────────────────────────────────────────

@app.get("/api/profile", tags=["Profile"])
async def profile_summary(profile_id: Optional[int] = None):
    """Get profile summary: streak, stars, XP, and quest config."""
    s = load()
    if not s:
        raise HTTPException(404, "No state saved yet")
    p = get_profile(s, profile_id)
    c = p.get("config", {})
    return {
        "name": p["name"],
        "avatar": p["avatar"],
        "streak": p["streak"],
        "stars": p["stars"],
        "total_xp": p["totalXp"],
        "days_until_next_star": c.get("daysPerStar", 7) - (p["streak"] % c.get("daysPerStar", 7)),
        "quest_count": len(p["quests"]),
        "quests": [{"id": q["id"], "name": q["name"], "icon": q["icon"]} for q in p["quests"]],
    }


@app.get("/api/profiles", tags=["Profile"])
async def list_profiles():
    """List all kid profiles."""
    s = load()
    if not s:
        raise HTTPException(404, "No state saved yet")
    return [{"id": p["id"], "name": p["name"], "avatar": p["avatar"], "streak": p["streak"], "stars": p["stars"]}
            for p in s["profiles"]]


# ─── Bank ────────────────────────────────────────────────────

@app.get("/api/bank", tags=["Bank"])
async def bank_balance(profile_id: Optional[int] = None):
    """Get Robux bank balance, interest info, and currency conversions."""
    s = load()
    if not s:
        raise HTTPException(404, "No state saved yet")
    p = get_profile(s, profile_id)
    c = p.get("config", {})
    bal = p.get("robuxBalance", 0)
    return {
        "profile": p["name"],
        "balance_robux": bal,
        "interest_earned": p.get("robuxInterestEarned", 0),
        "lifetime_earned": p.get("robuxLifetime", 0),
        "cashed_out": p.get("robuxCashedOut", 0),
        "interest_rate": f"{c.get('interestRate', 0.10) * 100:.0f}%",
        "savings_goal": c.get("savingsGoal", 500),
        "goal_progress": f"{min(100, (bal / max(1, c.get('savingsGoal', 500))) * 100):.1f}%",
        "fx": {
            "usd": round(bal * ROBUX_TO_USD, 2),
            "minecoins": int(bal * MC_PER_ROBUX),
        },
    }


# ─── History ─────────────────────────────────────────────────

@app.get("/api/history/{date_str}", tags=["History"])
async def history_day(date_str: str, profile_id: Optional[int] = None):
    """Look up a specific day's history. Format: YYYY-MM-DD"""
    s = load()
    if not s:
        raise HTTPException(404, "No state saved yet")
    p = get_profile(s, profile_id)
    today_str = date.today().isoformat()
    if date_str == today_str:
        return {"date": date_str, "source": "today", "completed": list(p["today"].get("completed", {}).keys()),
                "approved": p["today"].get("approved", False), "excused": False}
    h = p.get("history", {}).get(date_str)
    if not h:
        return {"date": date_str, "source": "history", "completed": [], "approved": False, "excused": False,
                "note": "No record for this date"}
    return {"date": date_str, "source": "history", "completed": h.get("completed", []),
            "approved": h.get("approved", False), "excused": h.get("excused", False)}


@app.get("/api/streak", tags=["History"])
async def streak_info(profile_id: Optional[int] = None):
    """Get current streak details and recent history."""
    s = load()
    if not s:
        raise HTTPException(404, "No state saved yet")
    p = get_profile(s, profile_id)
    # Build last 7 days
    recent = []
    for i in range(6, -1, -1):
        d = (date.today() - timedelta(days=i)).isoformat()
        if d == date.today().isoformat():
            recent.append({"date": d, "status": "done" if p["today"].get("approved") else "pending"})
        else:
            h = p.get("history", {}).get(d)
            if h:
                status = "excused" if h.get("excused") else ("done" if h.get("approved") else "missed")
            else:
                status = "missed"
            recent.append({"date": d, "status": status})
    return {
        "profile": p["name"],
        "current_streak": p["streak"],
        "stars": p["stars"],
        "last_7_days": recent,
    }


# ─── Health ──────────────────────────────────────────────────

@app.get("/api/health", tags=["System"])
async def health():
    return {"status": "ok", "data_dir": str(DATA_DIR), "version": "2.0.0"}


# ─── Static ──────────────────────────────────────────────────

@app.get("/", include_in_schema=False)
async def root():
    return FileResponse(Path(__file__).parent / "index.html")


app.mount("/", StaticFiles(directory=Path(__file__).parent), name="static")
