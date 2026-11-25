#!/usr/bin/env python3
"""One-off: build website JSON (github/data/) from the Markdown reports written
before report.py started saving JSON itself.

Usage:
    python3 github/backfill_site_data.py          # skips reports that already have JSON
    python3 github/backfill_site_data.py --force  # rebuilds them all
"""
import argparse
import datetime as dt
import json
import os
import re

import report

LINE = re.compile(r"^\d+\. \[(?P<name>[^\]]+)\]\([^)]*\) · ★ (?P<s>[\d,]+) · ⑂ (?P<f>[\d,]+)"
                  r"(?: · \*\*\+(?P<g>[\d,]+) (?P<unit>stars|forks)\*\*)?(?: — (?P<d>.*))?$")
BASE = re.compile(r"snapshot from \w+ (\d+) (\w+)\. Tracking ([\d,]+) repositories")


def num(x):
    return int(x.replace(",", ""))


def parse(path):
    fn = os.path.basename(path)[:-3]
    date, _, mode = fn.rpartition("-")
    today = dt.date.fromisoformat(date)
    text = open(path, encoding="utf-8").read().splitlines()

    note, sections, current = "", [], None
    for ln in text:
        if ln.startswith("_") and ln.endswith("_") and not note and current is None:
            note = ln[1:-1]
        elif ln.startswith("## "):
            current = {"title": ln[3:], "unit": None, "empty": "No data yet.", "items": []}
            sections.append(current)
        elif current is not None and ln.startswith("_") and ln.endswith("_"):
            current["empty"] = ln[1:-1]
        elif current is not None:
            m = LINE.match(ln)
            if m:
                g = m.group("g")
                current["items"].append({"name": m.group("name"), "stars": num(m.group("s")),
                                         "forks": num(m.group("f")), "desc": m.group("d") or "",
                                         "gain": num(g) if g else None})
                if m.group("unit"):
                    current["unit"] = m.group("unit")

    weekly = mode == "weekly"
    period = "this week" if weekly else "last 24 hours"
    # Units on empty climbing sections can't be read from items; set them from the title.
    for s in sections:
        t = s["title"]
        if "climbing by forks" in t:
            s["unit"] = "forks"
        elif "climbing by stars" in t or t.startswith("Top 5 trending"):
            s["unit"] = "stars"

    out_sections, topics = [], {}
    labels = {label: slug for label, slug in report.TOPICS}
    for s in sections:
        t = s["title"]
        if t.startswith("Top 10 repositories of all time by stars"):
            s["key"] = "all_stars"
        elif t.startswith("Top 10 repositories of all time by forks"):
            s["key"] = "all_forks"
        elif t.startswith("Top 5 climbing by stars"):
            s["key"] = "climb_stars"
        elif t.startswith("Top 5 climbing by forks"):
            s["key"] = "climb_forks"
        elif t.startswith("Top 5 trending"):
            s["key"] = "trending"
        else:
            label, _, rest = t.partition(" — ")
            if label not in labels:
                continue
            s["key"] = "climb" if "climbing" in rest else "top"
            topics.setdefault(label, {"label": label, "slug": labels[label]})[s["key"]] = s
            continue
        out_sections.append({"key": s["key"], **{k: s[k] for k in ("title", "unit", "empty", "items")}})

    baseline, tracked = None, None
    m = BASE.search(note)
    if m:
        tracked = num(m.group(3))
        for back in range(1, 15):
            d = today - dt.timedelta(days=back)
            if d.day == int(m.group(1)) and d.strftime("%B") == m.group(2):
                baseline = d.isoformat()
                break

    def tidy(s):
        return {"key": s["key"], "title": s["title"], "unit": s["unit"], "empty": s["empty"], "items": s["items"]}

    return {
        "date": date, "mode": mode,
        "title": "Weekly GitHub summary" if weekly else "Daily GitHub report",
        "period": period, "baseline": baseline, "tracked": tracked, "note": note,
        "sections": out_sections,
        "topics": [{"label": t["label"], "slug": t["slug"], "top": tidy(t["top"]), "climb": tidy(t["climb"])}
                   for label, t in topics.items() if "top" in t and "climb" in t],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    os.makedirs(report.DATA_DIR, exist_ok=True)
    for fn in sorted(os.listdir(report.REPORT_DIR)):
        if not fn.endswith(".md"):
            continue
        out = os.path.join(report.DATA_DIR, fn[:-3] + ".json")
        if os.path.exists(out) and not args.force:
            continue
        data = parse(os.path.join(report.REPORT_DIR, fn))
        with open(out, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
        print("wrote", out)
    report.write_data_index()


if __name__ == "__main__":
    main()
