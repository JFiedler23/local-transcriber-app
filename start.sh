#!/bin/bash
source .venv/bin/activate
trap 'kill -9 0' SIGINT
# No --reload: models take ~60s to load; reloading on every file change is unusable
uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8000 &
npm --prefix frontend run dev &
wait
