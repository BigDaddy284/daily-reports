# Daily reports

Automated reports produced by scheduled Claude Code tasks. Each report type lives in its own folder.

## `github/`

GitHub repository report.

- **Sun–Fri ~09:20 London:** daily report (lists of 5): climbing by stars and forks over 24 hours, trending, and per-topic lists for `ai`, `alternative`, `toy-project` and `built-with-ai`.
- **Saturday ~09:20 London:** weekly summary: all-time top 10 by stars and forks, plus all lists calculated over the week.

| Path | Contents |
|---|---|
| `github/report.py` | Fetches data via the GitHub search API, compares snapshots and writes the report |
| `github/reports/` | One Markdown file per report (`YYYY-MM-DD-daily.md` / `-weekly.md`) |
| `github/snapshots/` | Compressed star/fork counts; only the last 10 days are kept |

Run manually: `python3 github/report.py` (auto-picks daily or weekly), or add `--mode daily|weekly`.
