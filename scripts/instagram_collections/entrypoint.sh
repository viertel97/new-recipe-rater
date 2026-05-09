#!/bin/sh

run_sync() {
    echo "[$(date -Iseconds)] Running sync..."
    python /app/sync.py
    echo "[$(date -Iseconds)] Sync finished."
}

# Run immediately on container start
run_sync

# Then keep running every ~6 hours (+/- JITTER_PERCENT%)
while true; do
    SLEEP_SECONDS=$(awk -v base=21600 -v pct="${JITTER_PERCENT:-20}" 'BEGIN{
        srand(); min=base*(100-pct)/100; range=base*pct*2/100; print int(min+rand()*range)
    }')
    echo "[$(date -Iseconds)] Sleeping for ${SLEEP_SECONDS}s (~6h ±${JITTER_PERCENT:-20}%)..."
    sleep "$SLEEP_SECONDS"
    run_sync
done
