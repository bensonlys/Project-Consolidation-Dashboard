from __future__ import annotations

import json
import mimetypes
import os
import uuid
from datetime import date, datetime
from pathlib import Path

from flask import Flask, abort, jsonify, request, send_from_directory


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
UPLOAD_DIR = ROOT / "uploads"
DATA_FILE = DATA_DIR / "projects.json"

app = Flask(__name__, static_folder=str(ROOT), static_url_path="")
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024


def today_fy() -> str:
    return f"FY{date.today().year}"


def new_project() -> dict:
    return {
        "id": str(uuid.uuid4()),
        "projectName": "New project",
        "projectManager": "",
        "vendorCompany": "",
        "systemOwner": "",
        "description": "",
        "developmentBudget": 0,
        "operatingBudget": 0,
        "contractExpiryDates": [],
        "budgetApprovedDate": "",
        "commissionedDate": "",
        "financialYears": [{"year": today_fy(), "development": 0, "operating": 0}],
        "monthlyUtilisation": [],
        "attachments": [],
        "penetrationTests": [],
        "vulnerabilityAssessments": [],
        "riskAssessments": [],
    }


def seed_state() -> dict:
    project = new_project()
    project.update(
        {
            "projectName": "Core System Modernisation",
            "projectManager": "Aisha Tan",
            "vendorCompany": "Northstar Digital",
            "systemOwner": "Enterprise Applications",
            "description": (
                "Upgrade legacy application modules, improve service resilience, "
                "and migrate reporting workflows."
            ),
            "developmentBudget": 1250000,
            "operatingBudget": 320000,
            "contractExpiryDates": [{"date": "2027-03-31", "description": "Primary implementation contract"}],
            "budgetApprovedDate": "2026-02-14",
            "commissionedDate": "2026-04-01",
            "financialYears": [
                {"year": "FY2026", "development": 650000, "operating": 120000},
                {"year": "FY2027", "development": 600000, "operating": 200000},
            ],
            "monthlyUtilisation": [
                {"month": "2026-04", "development": 84000, "operating": 14000},
                {"month": "2026-05", "development": 92000, "operating": 15500},
            ],
            "penetrationTests": ["2026-03-18"],
            "vulnerabilityAssessments": ["2026-03-25"],
            "riskAssessments": ["2026-01-30"],
        }
    )
    return {"projects": [project], "selectedProjectId": project["id"]}


def ensure_storage() -> None:
    DATA_DIR.mkdir(exist_ok=True)
    UPLOAD_DIR.mkdir(exist_ok=True)
    if not DATA_FILE.exists():
        save_state(seed_state())


def load_state() -> dict:
    ensure_storage()
    with DATA_FILE.open("r", encoding="utf-8") as handle:
        state = json.load(handle)
    normalize_state(state)
    return state


def normalize_state(state: dict) -> None:
    for project in state.get("projects", []):
        legacy_date = project.pop("contractExpiryDate", "")
        if "contractExpiryDates" not in project:
            project["contractExpiryDates"] = [legacy_date] if legacy_date else []
        project["contractExpiryDates"] = [
            normalize_contract_row(row) for row in project.get("contractExpiryDates", []) if row
        ]


def normalize_contract_row(row) -> dict:
    if isinstance(row, dict):
        return {
            "date": row.get("date", ""),
            "description": row.get("description", ""),
        }
    return {"date": str(row), "description": ""}


def save_state(state: dict) -> None:
    DATA_DIR.mkdir(exist_ok=True)
    tmp_file = DATA_FILE.with_suffix(".tmp")
    with tmp_file.open("w", encoding="utf-8") as handle:
        json.dump(state, handle, indent=2)
    tmp_file.replace(DATA_FILE)


def safe_upload_name(filename: str) -> str:
    original = Path(filename)
    stem = original.stem or "attachment"
    suffix = original.suffix
    cleaned = "".join(char for char in stem if char.isalnum() or char in ("-", "_", " ")).strip()
    cleaned = cleaned[:80] or "attachment"
    return f"{uuid.uuid4().hex}-{cleaned}{suffix}"


@app.get("/")
def index():
    return app.send_static_file("index.html")


@app.get("/api/state")
def get_state():
    return jsonify(load_state())


@app.post("/api/state")
def update_state():
    payload = request.get_json(silent=True) or {}
    if not isinstance(payload.get("projects"), list):
        return jsonify({"error": "projects must be a list"}), 400
    normalize_state(payload)
    save_state(payload)
    return jsonify(payload)


@app.post("/api/projects")
def create_project():
    state = load_state()
    project = new_project()
    state["projects"].insert(0, project)
    state["selectedProjectId"] = project["id"]
    save_state(state)
    return jsonify(state), 201


@app.delete("/api/projects/<project_id>")
def delete_project(project_id: str):
    state = load_state()
    state["projects"] = [project for project in state["projects"] if project["id"] != project_id]
    if not state["projects"]:
        state["projects"].append(new_project())
    state["selectedProjectId"] = state["projects"][0]["id"]
    save_state(state)
    return jsonify(state)


@app.post("/api/projects/<project_id>/attachments")
def upload_attachments(project_id: str):
    state = load_state()
    project = next((item for item in state["projects"] if item["id"] == project_id), None)
    if not project:
        return jsonify({"error": "Project not found"}), 404

    for uploaded in request.files.getlist("files"):
        if not uploaded.filename:
            continue
        stored_name = safe_upload_name(uploaded.filename)
        target = UPLOAD_DIR / stored_name
        uploaded.save(target)
        project["attachments"].append(
            {
                "id": str(uuid.uuid4()),
                "name": uploaded.filename,
                "storedName": stored_name,
                "url": f"/uploads/{stored_name}",
                "size": target.stat().st_size,
                "type": uploaded.mimetype or mimetypes.guess_type(uploaded.filename)[0] or "",
                "addedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            }
        )

    save_state(state)
    return jsonify(state), 201


@app.get("/uploads/<path:filename>")
def uploaded_file(filename: str):
    return send_from_directory(UPLOAD_DIR, filename)


@app.get("/<path:filename>")
def static_file(filename: str):
    target = (ROOT / filename).resolve()
    if not target.is_file() or ROOT not in target.parents:
        abort(404)
    return send_from_directory(ROOT, filename)


def main() -> None:
    ensure_storage()
    port = int(os.environ.get("PORT", "8000"))
    app.run(host="127.0.0.1", port=port, debug=True)


if __name__ == "__main__":
    main()
