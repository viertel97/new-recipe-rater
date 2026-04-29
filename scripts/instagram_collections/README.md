# Instagram Collections Puller

Fetch saved Instagram collections to local JSON.

## Setup

```bash
cd scripts/instagram_collections
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Credentials

Uses env vars (no file persistence):

```bash
export IG_USERNAME="your_handle"
export IG_PASSWORD="your_password"
```

Session persists in `session.json` after first login — subsequent runs skip re-auth unless expired.

2FA supported: script prompts for code interactively.

## Usage

```bash
# List collections
python pull_collections.py --list

# Pull one collection
python pull_collections.py --collection "Recipes"

# Pull all
python pull_collections.py --all

# Cap posts per collection
python pull_collections.py --all --limit 50
```

Output: `output/<collection_name>.json`

## Output format

```json
{
  "collection": {"pk": "...", "name": "Recipes", "count": 42},
  "media": [
    {
      "pk": "...",
      "code": "CxYz...",
      "url": "https://www.instagram.com/p/CxYz.../",
      "media_type": 1,
      "taken_at": "2026-01-15T12:34:56+00:00",
      "caption": "...",
      "username": "...",
      "thumbnail_url": "...",
      "video_url": null
    }
  ]
}
```

## Import into database

Second script writes the pulled JSON into the `Link` table under user `janik`.

```bash
# One file
python import_to_db.py output/Recipes.json

# Everything in output/
python import_to_db.py --all

# Only posts from 2026+
python import_to_db.py --all --since 2026

# Exact cutoff
python import_to_db.py output/All_posts.json --since 2026-01-01

# Preview without writing
python import_to_db.py --all --since 2026 --dry-run
```

- Reads `DATABASE_URL` from repo `.env`.
- Looks up user by `username = "janik"`; errors if missing.
- Dedup: `ON CONFLICT (url) DO NOTHING` (leverages the unique index).
- Inserts with `rating = PENDING` and a note like `[IG:<collection>] @<user>\n\n<caption>`.
- `--since` accepts `YYYY` or `YYYY-MM-DD`; posts without `taken_at` are dropped when filtering.

## Warnings

- Uses **reverse-engineered private API** (`instagrapi`). Violates IG ToS.
- Account ban risk. Use secondary account if possible.
- Rate limits: script sleeps 1–3s between calls. Don't run aggressively.
- `session.json` contains auth tokens — gitignored.
