# The Daily Index

**A daily newspaper of what's climbing on GitHub.**

Read it at **https://bigdaddy284.github.io/daily-reports/**

Every morning a scheduled task checks the star and fork counts of about 5,000 popular and fast-moving repositories, compares them with the day before, and publishes the results as a report and on the website.

## What's in the report

**Daily report** (Sunday to Friday, about 09:20 London time). Each list has 5 repos:

- **Climbing by stars**: the biggest star gains in the last 24 hours.
- **Climbing by forks**: the biggest fork gains in the last 24 hours.
- **Trending**: the biggest star gains among repos created in the last 30 days.
- **Editor's Interests**: four GitHub topics, `ai`, `alternative`, `toy-project` and `built-with-ai`. Each one gets two lists: its top repos by stars among those updated in the last 7 days, and its biggest climbers.

**Weekly summary** (Saturday): the all-time top 10 repos by stars and by forks, plus every list above, measured over the whole week.

## The website

| Page | What it shows |
|---|---|
| [Today](https://bigdaddy284.github.io/daily-reports/) | The latest daily report, led by the day's top climber |
| [Editor's Interests](https://bigdaddy284.github.io/daily-reports/interests.html) | Each topic in full |
| [Search](https://bigdaddy284.github.io/daily-reports/search.html) | Live search of all of GitHub: repos by stars, forks or last update, people by followers, and help-wanted issues |
| [Weekly](https://bigdaddy284.github.io/daily-reports/weekly.html) | The latest Saturday summary |
| [Archive](https://bigdaddy284.github.io/daily-reports/archive.html) | Every report so far |

Search runs in your browser straight against GitHub's public search API. GitHub allows about 10 searches a minute without signing in, and the page shows how many you have left.

## How it works

| Path | Contents |
|---|---|
| `github/report.py` | Fetches counts through the GitHub search API, compares snapshots, and writes the report as Markdown and JSON |
| `github/reports/` | One Markdown file per report (`YYYY-MM-DD-daily.md` / `-weekly.md`) |
| `github/data/` | The same reports as JSON, read by the website, plus `index.json` listing them all |
| `github/snapshots/` | Compressed star and fork counts; only the last 10 days are kept |
| `github/backfill_site_data.py` | One-off tool that converted reports written before the JSON existed |
| `index.html`, `interests.html`, `search.html`, `weekly.html`, `archive.html`, `assets/` | The website: plain HTML, CSS and JavaScript, served by GitHub Pages from the repo root |

To run a report by hand (this needs the [GitHub CLI](https://cli.github.com/), signed in):

```sh
python3 github/report.py                 # picks daily or weekly by the day of the week
python3 github/report.py --mode weekly   # or force one
```

Climbing figures need a snapshot from the day before, so a brand-new setup shows them from its second run.

## Licence

The code is released under the [MIT Licence](LICENSE), so you're free to use, copy, change and share it.

Repository names, descriptions and counts in the reports come from GitHub's public API, and each project belongs to its owners.
