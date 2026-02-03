#!/bin/bash
# Usage: ./update-status.sh [active|idle] "Task description"
# Examples:
#   ./update-status.sh active "Building dashboard"
#   ./update-status.sh idle

API_KEY=$(cat ~/jarvis-dashboard/api-key.txt 2>/dev/null)
HOST="${JARVIS_DASHBOARD_HOST:-http://localhost:3847}"

if [ "$1" = "active" ]; then
  curl -s -X POST "$HOST/api/internal/status" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"active\": true, \"task\": \"$2\"}"
else
  curl -s -X POST "$HOST/api/internal/status" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"active": false}'
fi
