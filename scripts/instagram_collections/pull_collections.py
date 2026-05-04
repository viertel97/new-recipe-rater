"""Pull saved Instagram collections via instagrapi.

Usage:
    python pull_collections.py --list
    python pull_collections.py --collection "Recipes"
    python pull_collections.py --all
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

from instagrapi import Client
from instagrapi.exceptions import LoginRequired, TwoFactorRequired


SCRIPT_DIR = Path(__file__).resolve().parent
SESSION_FILE = Path(os.environ.get("DATA_DIR", SCRIPT_DIR)) / "session.json"
OUTPUT_DIR = Path(os.environ.get("DATA_DIR", SCRIPT_DIR)) / "output"


def login(username: str, password: str) -> Client:
    cl = Client()
    cl.delay_range = [1, 3]

    if SESSION_FILE.exists():
        try:
            cl.load_settings(SESSION_FILE)
            cl.login(username, password)
            cl.get_timeline_feed()
            return cl
        except LoginRequired:
            print("Session expired. Fresh login.", file=sys.stderr)
            SESSION_FILE.unlink(missing_ok=True)
            cl = Client()
            cl.delay_range = [1, 3]

    try:
        cl.login(username, password)
    except TwoFactorRequired:
        code = input("2FA code: ").strip()
        cl.login(username, password, verification_code=code)

    cl.dump_settings(SESSION_FILE)
    return cl


def list_collections(cl: Client) -> list[dict[str, Any]]:
    cols = cl.collections()
    return [{"pk": str(c.id), "name": c.name, "count": c.media_count} for c in cols]


def fetch_collection_media(cl: Client, collection_pk: str, limit: int = 0) -> list[dict[str, Any]]:
    pk: int | str = collection_pk if not collection_pk.isdigit() else int(collection_pk)
    medias = cl.collection_medias(pk, amount=limit)
    out = []
    for m in medias:
        out.append({
            "pk": str(m.pk),
            "code": m.code,
            "url": f"https://www.instagram.com/p/{m.code}/",
            "media_type": m.media_type,
            "taken_at": m.taken_at.isoformat() if m.taken_at else None,
            "caption": m.caption_text,
            "username": m.user.username if m.user else None,
            "thumbnail_url": str(m.thumbnail_url) if m.thumbnail_url else None,
            "video_url": str(m.video_url) if m.video_url else None,
        })
    return out


def save_json(data: Any, name: str) -> Path:
    OUTPUT_DIR.mkdir(exist_ok=True)
    path = OUTPUT_DIR / f"{name}.json"
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False))
    return path


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--list", action="store_true", help="List collections only")
    p.add_argument("--collection", default="All posts", help="Collection name to pull (default: 'All posts')")
    p.add_argument("--all", action="store_true", help="Pull all collections")
    p.add_argument("--limit", type=int, default=0, help="Max posts per collection (0=all)")
    args = p.parse_args()

    username = os.environ.get("IG_USERNAME")
    password = os.environ.get("IG_PASSWORD")
    if not username or not password:
        print("Set IG_USERNAME and IG_PASSWORD env vars.", file=sys.stderr)
        return 1

    cl = login(username, password)

    collections = list_collections(cl)
    if not collections:
        print("No collections found.")
        return 0

    if args.list:
        for c in collections:
            print(f"  {c['name']}  ({c['count']} posts)  pk={c['pk']}")
        return 0

    if args.all:
        targets = collections
    else:
        match = [c for c in collections if c["name"].lower() == args.collection.lower()]
        if not match:
            print(f"Collection '{args.collection}' not found.", file=sys.stderr)
            print("Available:", ", ".join(c["name"] for c in collections), file=sys.stderr)
            return 1
        targets = match

    for c in targets:
        print(f"Pulling '{c['name']}' ({c['count']} posts)...")
        media = fetch_collection_media(cl, c["pk"], limit=args.limit)
        safe = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in c["name"])
        path = save_json({"collection": c, "media": media}, safe)
        print(f"  -> {path} ({len(media)} items)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
