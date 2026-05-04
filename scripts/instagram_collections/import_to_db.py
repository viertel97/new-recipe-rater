"""Import Instagram collection JSON into the Link table.

Usage:
    python import_to_db.py output/Recipes.json
    python import_to_db.py --all
    python import_to_db.py --all --dry-run
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import psycopg
import urllib.request
from cuid import cuid

SCRIPT_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = Path(os.environ.get("DATA_DIR", SCRIPT_DIR)) / "output"
REPO_ROOT = SCRIPT_DIR.parent.parent
ENV_FILE = REPO_ROOT / ".env"

SUBMITTER_USERNAME = "janik"


def trigger_categorize() -> None:
    url = os.environ.get("APP_URL", "http://localhost:3000")
    secret = os.environ.get("API_SECRET")
    if not secret:
        print("API_SECRET not set, skipping categorization trigger.")
        return
    try:
        req = urllib.request.Request(
            f"{url}/api/admin/categorize-pending",
            headers={"Authorization": f"Bearer {secret}"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=30) as res:
            data = json.loads(res.read())
            print(f"Triggered categorization for {data.get('queued', 0)} pending links.")
    except Exception as e:
        print(f"Warning: failed to trigger categorization: {e}")


def load_env() -> None:
    if not ENV_FILE.exists():
        return
    for line in ENV_FILE.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        v = v.strip().strip('"').strip("'")
        os.environ.setdefault(k.strip(), v)


def db_url() -> str:
    raw = os.environ.get("DATABASE_URL")
    if not raw:
        print("DATABASE_URL not set.", file=sys.stderr)
        sys.exit(1)
    # Prisma appends ?schema=public — libpq rejects it.
    return re.sub(r"[?&]schema=[^&]*", "", raw)


def get_user_id(conn: psycopg.Connection, username: str) -> str:
    with conn.cursor() as cur:
        cur.execute('SELECT id FROM "User" WHERE username = %s', (username,))
        row = cur.fetchone()
    if not row:
        print(f"User '{username}' not found.", file=sys.stderr)
        sys.exit(1)
    return row[0]


def parse_since(value: str) -> datetime:
    # Accept YYYY or YYYY-MM-DD.
    if re.fullmatch(r"\d{4}", value):
        return datetime(int(value), 1, 1, tzinfo=timezone.utc)
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def keep_by_date(taken_raw: str | None, since: datetime | None) -> bool:
    if since is None:
        return True
    if not taken_raw:
        return False
    taken = datetime.fromisoformat(taken_raw)
    if taken.tzinfo is None:
        taken = taken.replace(tzinfo=timezone.utc)
    return taken >= since


def build_entry(media: dict[str, Any], collection_name: str) -> dict[str, Any] | None:
    url = media.get("url")
    if not url:
        return None
    note = f"[IG:{collection_name}] @{media.get('username') or '?'}"
    caption = media.get("caption") or ""
    if caption:
        note += f"\n\n{caption}"
    return {"url": url, "note": note}


def load_entries(paths: list[Path], since: datetime | None = None) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    dropped = 0
    for p in paths:
        data = json.loads(p.read_text())
        collection_name = data.get("collection", {}).get("name", p.stem)
        for m in data.get("media", []):
            if not keep_by_date(m.get("taken_at"), since):
                dropped += 1
                continue
            entry = build_entry(m, collection_name)
            if entry:
                entries.append(entry)
    if since is not None and dropped:
        print(f"Filtered out {dropped} posts older than {since.date().isoformat()}.")
    return entries


def insert(conn: psycopg.Connection, user_id: str, entries: list[dict[str, Any]], dry_run: bool) -> tuple[int, int]:
    inserted = 0
    skipped = 0
    with conn.cursor() as cur:
        for e in entries:
            if dry_run:
                cur.execute('SELECT 1 FROM "Link" WHERE url = %s', (e["url"],))
                if cur.fetchone():
                    skipped += 1
                else:
                    inserted += 1
                continue
            cur.execute(
                '''
                INSERT INTO "Link" (id, url, rating, notes, "createdAt", "submittedById")
                VALUES (%s, %s, 'PENDING', %s, NOW(), %s)
                ON CONFLICT (url) DO NOTHING
                RETURNING id
                ''',
                (cuid(), e["url"], e["note"], user_id),
            )
            if cur.fetchone():
                inserted += 1
            else:
                skipped += 1
    if not dry_run:
        conn.commit()
    return inserted, skipped


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("file", nargs="?", help="JSON file to import")
    p.add_argument("--all", action="store_true", help="Import all JSON files in output/")
    p.add_argument("--dry-run", action="store_true", help="No writes; report counts only")
    p.add_argument(
        "--since",
        default="2026",
        help="Only import posts taken on/after this date (YYYY or YYYY-MM-DD). Default: 2026. Pass 'all' to disable.",
    )
    args = p.parse_args()

    since = None if args.since.lower() == "all" else parse_since(args.since)

    if not args.file and not args.all:
        p.print_help()
        return 1

    load_env()

    if args.all:
        paths = sorted(OUTPUT_DIR.glob("*.json"))
        if not paths:
            print(f"No JSON files in {OUTPUT_DIR}.", file=sys.stderr)
            return 1
    else:
        paths = [Path(args.file)]
        if not paths[0].exists():
            print(f"File not found: {paths[0]}", file=sys.stderr)
            return 1

    entries = load_entries(paths, since=since)
    print(f"Loaded {len(entries)} entries from {len(paths)} file(s).")

    with psycopg.connect(db_url()) as conn:
        user_id = get_user_id(conn, SUBMITTER_USERNAME)
        print(f"Submitter: {SUBMITTER_USERNAME} ({user_id})")
        inserted, skipped = insert(conn, user_id, entries, args.dry_run)

    tag = "WOULD INSERT" if args.dry_run else "inserted"
    print(f"{tag}: {inserted}  skipped (dup): {skipped}")

    if not args.dry_run and inserted > 0:
        trigger_categorize()

    return 0


if __name__ == "__main__":
    sys.exit(main())
