#!/bin/sh

run_sync() {
    echo "[$(date -Iseconds)] Running sync..."
    python /app/sync.py
    echo "[$(date -Iseconds)] Sync finished."
}

# Run immediately on container start
run_sync

# Then keep running every 6 hours
while true; do
    echo "[$(date -Iseconds)] Sleeping for 6 hours..."
    sleep 6h
    run_sync
done
