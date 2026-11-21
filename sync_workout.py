#!/usr/bin/env python3
"""Sync a workout to the workout tracker Worker.

Usage:
  python3 sync_workout.py workout.json     # post one workout object
  python3 sync_workout.py --seed           # post every workout in seed.json

The workout JSON is the sync payload: {"date": "YYYY-MM-DD", "letter": "A",
"exercises": [{"name": "...", "load": 50, ...}, ...]}.
Bearer token is read from .sync-secret in this directory (never committed).
A browser User-Agent is sent: Cloudflare edge 403s Python urllib's
default UA.
"""
import json
import os
import sys
import urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
SECRET_FILE = os.path.join(BASE, ".sync-secret")
SYNC_URL = "https://workout.oedinger.stream/api/sync"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36")


def post_workout(secret, workout):
    body = json.dumps(workout, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        SYNC_URL, data=body, method="POST",
        headers={"Content-Type": "application/json",
                 "Authorization": "Bearer " + secret,
                 "User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        text = r.read().decode("utf-8")
        print(r.status, text)
        return r.status


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    with open(SECRET_FILE, encoding="utf-8") as f:
        secret = f.read().strip()
    if not secret:
        raise SystemExit(".sync-secret is empty")

    if sys.argv[1] == "--seed":
        with open(os.path.join(BASE, "seed.json"), encoding="utf-8") as f:
            workouts = json.load(f)
        if isinstance(workouts, dict):
            workouts = workouts.get("workouts", [workouts])
        for w in workouts:
            print("syncing", w.get("date"), w.get("letter"))
            post_workout(secret, w)
        return

    with open(sys.argv[1], encoding="utf-8") as f:
        payload = json.load(f)
    workouts = payload if isinstance(payload, list) else [payload]
    for w in workouts:
        post_workout(secret, w)


if __name__ == "__main__":
    main()
