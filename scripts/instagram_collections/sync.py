"""One-shot: pull Instagram 'All posts' and import to DB.

Imports functions from pull_collections and import_to_db directly —
no subprocess, shares one Python process.

Usage:
    python sync.py
    python sync.py --dry-run
    python sync.py --since 2025
    python sync.py --skip-pull        # reuse existing JSON
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import psycopg

from pull_collections import (
    OUTPUT_DIR,
    fetch_collection_media,
    list_collections,
    login,
    save_json,
)
from import_to_db import (
    SUBMITTER_USERNAME,
    db_url,
    get_user_id,
    insert,
    load_entries,
    load_env,
    parse_since,
    trigger_backfill,
    trigger_categorize,
)

DEFAULT_COLLECTION = "All posts"
DEFAULT_SINCE = "2026"


def pull(collection_name: str, limit: int) -> Path:
    username = os.environ.get("IG_USERNAME")
    password = os.environ.get("IG_PASSWORD")
    if not username or not password:
        print("Set IG_USERNAME and IG_PASSWORD env vars.", file=sys.stderr)
        sys.exit(1)

    cl = login(username, password)
    collections = list_collections(cl)
    match = [c for c in collections if c["name"].lower() == collection_name.lower()]
    if not match:
        print(f"Collection '{collection_name}' not found.", file=sys.stderr)
        print("Available:", ", ".join(c["name"] for c in collections), file=sys.stderr)
        sys.exit(1)

    target = match[0]
    print(f"Pulling '{target['name']}' ({target['count']} posts)...")
    media = fetch_collection_media(cl, target["pk"], limit=limit)
    safe = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in target["name"])
    path = save_json({"collection": target, "media": media}, safe)
    print(f"  -> {path} ({len(media)} items)")
    return path


def do_import(paths: list[Path], since_raw: str, dry_run: bool) -> int:
    since = None if since_raw.lower() == "all" else parse_since(since_raw)
    load_env()

    entries = load_entries(paths, since=since)
    print(f"Loaded {len(entries)} entries from {len(paths)} file(s).")

    with psycopg.connect(db_url()) as conn:
        user_id = get_user_id(conn, SUBMITTER_USERNAME)
        print(f"Submitter: {SUBMITTER_USERNAME} ({user_id})")
        inserted, skipped = insert(conn, user_id, entries, dry_run)

    tag = "WOULD INSERT" if dry_run else "inserted"
    print(f"{tag}: {inserted}  skipped (dup): {skipped}")
    return inserted


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--collection", default=DEFAULT_COLLECTION, help=f"Collection to pull (default: {DEFAULT_COLLECTION!r})")
    p.add_argument("--since", default=DEFAULT_SINCE, help=f"Import posts from this date on. YYYY or YYYY-MM-DD. 'all' disables. Default: {DEFAULT_SINCE}")
    p.add_argument("--limit", type=int, default=0, help="Max posts to pull (0 = all)")
    p.add_argument("--dry-run", action="store_true", help="Preview import; no DB writes")
    p.add_argument("--skip-pull", action="store_true", help="Skip pull; import existing JSON in output/")
    args = p.parse_args()

    if args.skip_pull:
        paths = sorted(OUTPUT_DIR.glob("*.json"))
        if not paths:
            print(f"No JSON files in {OUTPUT_DIR}.", file=sys.stderr)
            return 1
    else:
        paths = [pull(args.collection, args.limit)]

    inserted = do_import(paths, args.since, args.dry_run)
    if not args.dry_run and inserted > 0:
        trigger_backfill()
        trigger_categorize()
    return 0


if __name__ == "__main__":
    sys.exit(main())
