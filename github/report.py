#!/usr/bin/env python3
"""GitHub daily / weekly report.

Pulls current star and fork counts for a pool of repositories via the GitHub
search API (through the `gh` CLI), saves a compressed snapshot, compares it
with earlier snapshots to work out what is climbing, and writes a Markdown
report in UK English.

Usage:
    python3 report.py            # daily on Sun-Fri, weekly on Saturday (London time)
    python3 report.py --mode daily|weekly
"""
import argparse
import datetime as dt
import gzip
import json
import os
import subprocess
import sys
import time
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.abspath(__file__))
SNAP_DIR = os.path.join(ROOT, "snapshots")
REPORT_DIR = os.path.join(ROOT, "reports")
try:
    LONDON = ZoneInfo("Europe/London")
except Exception:  # Windows without the tzdata package
    sys.exit("error: time zone data missing - run: pip install tzdata")

# Topics exactly as requested (GitHub topic slugs).
TOPICS = [("AI", "ai"), ("Alternative", "alternative"),
          ("toy-project", "toy-project"), ("built-with-ai", "built-with-ai")]
TOPIC_SLUGS = {slug for _, slug in TOPICS}

KEEP_SNAPSHOTS_DAYS = 10
SEARCH_PAUSE = 2.2  # search API allows 30 requests/minute


# --------------------------------------------------------------------------- fetch
def gh_search(query, sort, pages, per_page=100):
    """Yield repo items for a search query, up to `pages` pages."""
    for page in range(1, pages + 1):
        path = (f"search/repositories?q={query}&sort={sort}&order=desc"
                f"&per_page={per_page}&page={page}")
        data = None
        for attempt in range(4):
            res = subprocess.run(["gh", "api", path], capture_output=True, text=True)
            if res.returncode == 0:
                data = json.loads(res.stdout)
                break
            time.sleep(10 * (attempt + 1))
        time.sleep(SEARCH_PAUSE)
        if data is None:
            print(f"warning: search failed: {query} page {page}: {res.stderr.strip()[:200]}",
                  file=sys.stderr)
            return
        items = data.get("items", [])
        yield from items
        if len(items) < per_page:
            return


def slim(item):
    return {
        "s": item["stargazers_count"],
        "f": item["forks_count"],
        "c": item["created_at"],
        "p": item.get("pushed_at"),
        "d": (item.get("description") or "")[:90],
        "t": sorted(set(item.get("topics") or []) & TOPIC_SLUGS),
    }


def build_pool(today):
    since30 = (today - dt.timedelta(days=30)).isoformat()
    since7 = (today - dt.timedelta(days=7)).isoformat()
    queries = [
        ("stars:>=1000", "stars", 10),            # top ~1,000 by stars
        ("forks:>=500", "forks", 10),             # top ~1,000 by forks
        (f"created:>={since30}", "stars", 10),    # popular new repos (trending pool)
        (f"pushed:>={since7}+stars:>=200", "updated", 5),  # recently active
    ]
    for _, slug in TOPICS:
        queries.append((f"topic:{slug}", "stars", 10))
        queries.append((f"topic:{slug}+created:>={since30}", "stars", 3))
    pool = {}
    for q, sort, pages in queries:
        for item in gh_search(q, sort, pages):
            pool[item["full_name"]] = slim(item)
    # Top 5 per topic by stars among repos updated in the last 7 days.
    topic_recent = {}
    for _, slug in TOPICS:
        rows = []
        for item in gh_search(f"topic:{slug}+pushed:>={since7}", "stars", 1, per_page=5):
            pool[item["full_name"]] = slim(item)
            rows.append(item["full_name"])
        topic_recent[slug] = rows
    return pool, topic_recent


# --------------------------------------------------------------------------- snapshots
def snap_path(date):
    return os.path.join(SNAP_DIR, f"{date.isoformat()}.json.gz")


def save_snapshot(date, taken_at, pool):
    os.makedirs(SNAP_DIR, exist_ok=True)
    with gzip.open(snap_path(date), "wt", encoding="utf-8") as fh:
        # Only what the comparisons need; descriptions are not stored, to keep the repo small.
        repos = {n: {"s": r["s"], "f": r["f"], "c": r["c"][:19], **({"t": r["t"]} if r["t"] else {})}
                 for n, r in pool.items()}
        json.dump({"taken_at": taken_at, "repos": repos}, fh, separators=(",", ":"))


def load_snapshot(date):
    p = snap_path(date)
    if not os.path.exists(p):
        return None
    with gzip.open(p, "rt", encoding="utf-8") as fh:
        return json.load(fh)


def find_baseline(today, days_back):
    """Closest earlier snapshot to `days_back` days ago (prefers exact, then nearer)."""
    for delta in [0, 1, -1, 2, -2]:
        d = today - dt.timedelta(days=days_back + delta)
        if d >= today:
            continue
        snap = load_snapshot(d)
        if snap:
            return d, snap
    return None, None


def prune(today):
    if not os.path.isdir(SNAP_DIR):
        return
    for name in os.listdir(SNAP_DIR):
        try:
            d = dt.date.fromisoformat(name.split(".")[0])
        except ValueError:
            continue
        if (today - d).days > KEEP_SNAPSHOTS_DAYS:
            os.remove(os.path.join(SNAP_DIR, name))


# --------------------------------------------------------------------------- maths
def gains(pool, base, metric):
    """Gain in `metric` ('s' or 'f') since the baseline snapshot."""
    if not base:
        return {}
    base_repos, base_time = base["repos"], base["taken_at"]
    out = {}
    for name, r in pool.items():
        if name in base_repos:
            out[name] = r[metric] - base_repos[name][metric]
        elif r["c"][:19] > base_time[:19]:  # created after the baseline: everything is new
            out[name] = r[metric]
    return out


def top(names_scores, n):
    return sorted(names_scores, key=lambda x: x[1], reverse=True)[:n]


# --------------------------------------------------------------------------- output
def fmt(n):
    return f"{n:,}"


def line(i, name, r, extra=""):
    desc = f" — {r['d']}" if r["d"] else ""
    return (f"{i}. [{name}](https://github.com/{name}) · ★ {fmt(r['s'])} · "
            f"⑂ {fmt(r['f'])}{extra}{desc}")


def section(title, rows, pool, unit=None, empty="No data yet."):
    out = [f"## {title}", ""]
    if not rows:
        out.append(f"_{empty}_")
    for i, (name, score) in enumerate(rows, 1):
        extra = f" · **+{fmt(score)} {unit}**" if unit else ""
        out.append(line(i, name, pool[name], extra))
    out.append("")
    return out


def build_report(mode, today, pool, topic_recent):
    weekly = mode == "weekly"
    days = 7 if weekly else 1
    period = "this week" if weekly else "last 24 hours"
    base_date, base = find_baseline(today, days)
    no_base = ("No comparison yet — the first snapshot was taken today, so climbing "
               "figures start from the next run." if not weekly else
               "Not enough history yet for weekly figures — these start once a week "
               "of snapshots exists.")

    star_g = gains(pool, base, "s")
    fork_g = gains(pool, base, "f")
    since30 = (today - dt.timedelta(days=30)).isoformat()

    title = "Weekly GitHub summary" if weekly else "Daily GitHub report"
    lines = [f"# {title} — {today:%A} {today.day} {today:%B %Y}", ""]
    if base:
        lines += [f"_Climbing figures compare with the snapshot from "
                  f"{base_date:%A} {base_date.day} {base_date:%B}. Tracking {fmt(len(pool))} repositories._", ""]
    else:
        lines += [f"_{no_base}_", ""]

    if weekly:
        by_stars = top([(n, r["s"]) for n, r in pool.items()], 10)
        by_forks = top([(n, r["f"]) for n, r in pool.items()], 10)
        lines += section("Top 10 repositories of all time by stars", by_stars, pool)
        lines += section("Top 10 repositories of all time by forks", by_forks, pool)

    lines += section(f"Top 5 climbing by stars ({period})",
                     top([(n, g) for n, g in star_g.items() if g > 0], 5),
                     pool, "stars", no_base)
    lines += section(f"Top 5 climbing by forks ({period})",
                     top([(n, g) for n, g in fork_g.items() if g > 0], 5),
                     pool, "forks", no_base)
    lines += section(f"Top 5 trending ({period}, repositories created in the last 30 days)",
                     top([(n, g) for n, g in star_g.items()
                          if g > 0 and pool[n]["c"][:10] >= since30], 5),
                     pool, "stars", no_base)

    for label, slug in TOPICS:
        recent = [(n, pool[n]["s"]) for n in topic_recent.get(slug, [])]
        lines += section(f"{label} — top 5 by stars (updated in the last 7 days)", recent, pool,
                         empty="No repositories with this topic were updated in the last 7 days.")
        climb = top([(n, g) for n, g in star_g.items()
                     if g > 0 and slug in pool[n]["t"]], 5)
        lines += section(f"{label} — top 5 climbing by stars ({period})", climb, pool, "stars",
                         no_base if not base else "No repositories with this topic gained stars.")
    return "\n".join(lines).rstrip() + "\n"


# --------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["daily", "weekly", "auto"], default="auto")
    args = ap.parse_args()

    now = dt.datetime.now(LONDON)
    today = now.date()
    mode = args.mode
    if mode == "auto":
        mode = "weekly" if today.weekday() == 5 else "daily"

    pool, topic_recent = build_pool(today)
    if len(pool) < 500:
        sys.exit(f"error: only {len(pool)} repositories fetched; GitHub search may be failing")
    taken_at = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    report = build_report(mode, today, pool, topic_recent)
    save_snapshot(today, taken_at, pool)
    prune(today)

    os.makedirs(REPORT_DIR, exist_ok=True)
    out = os.path.join(REPORT_DIR, f"{today.isoformat()}-{mode}.md")
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(report)
    print(report)
    print(f"[saved {out}; pool {len(pool)} repos]", file=sys.stderr)


if __name__ == "__main__":
    main()
