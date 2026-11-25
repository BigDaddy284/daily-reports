/* The Daily Index: renders the daily GitHub reports (github/data/*.json)
   and runs live searches against the GitHub search API. No build step. */
(function () {
  "use strict";

  var DATA = "github/data/";
  var page = document.body.getAttribute("data-page");
  var main = document.getElementById("main");

  // ------------------------------------------------------------------ helpers
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmt(n) { return Number(n).toLocaleString("en-GB"); }
  function short(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "m";
    if (n >= 1e4) return Math.round(n / 1e3) + "k";
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
    return String(n);
  }
  function day(iso, opts) {
    return new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", Object.assign({ timeZone: "UTC" }, opts));
  }
  function longDate(iso) { return day(iso, { weekday: "long", day: "numeric", month: "long", year: "numeric" }); }
  function ago(ts) {
    var s = (Date.now() - new Date(ts).getTime()) / 1000;
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + "m ago";
    if (s < 86400) return Math.round(s / 3600) + "h ago";
    if (s < 86400 * 14) return Math.round(s / 86400) + "d ago";
    if (s < 86400 * 60) return Math.round(s / 604800) + "w ago";
    if (s < 86400 * 730) return Math.round(s / 2592000) + "mo ago";
    return Math.round(s / 31536000) + "y ago";
  }
  function gh(name) { return "https://github.com/" + name.split("/").map(encodeURIComponent).join("/"); }
  function param(k) { return new URLSearchParams(location.search).get(k); }
  function pct(v, max) { return Math.max(2, Math.round((v / (max || 1)) * 100)); }
  function getJSON(url) {
    return fetch(url, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(url + " returned " + r.status);
      return r.json();
    });
  }

  // ------------------------------------------------------------------ page shell
  var NAV = [["today", "index.html", "Today"], ["interests", "interests.html", "Editor's Interests"],
             ["search", "search.html", "Search"], ["weekly", "weekly.html", "Weekly"], ["archive", "archive.html", "Archive"]];

  function shell(dateLine) {
    var top = document.getElementById("top");
    top.innerHTML =
      '<div class="topbar"><span id="dateline">' + esc(dateLine || "") + "</span>" +
      (page === "search" ? '<span id="limit"></span>' :
        '<form action="search.html" role="search"><label for="topq">Search GitHub</label>' +
        '<input id="topq" name="q" placeholder="any keyword"><button class="btn" type="submit">Go</button></form>') +
      "</div>" +
      '<header class="masthead"><a class="name" href="index.html">The Daily Index</a><nav aria-label="Sections">' +
      NAV.map(function (n) {
        return '<a href="' + n[1] + '"' + (n[0] === page ? ' class="on" aria-current="page"' : "") + ">" + esc(n[2]) + "</a>";
      }).join("") + "</nav></header>";
    document.getElementById("foot").textContent =
      "A new report every morning at about 09:20 London time. The weekly summary comes out on Saturday.";
  }
  function setDateline(t) { var el = document.getElementById("dateline"); if (el) el.textContent = t; }
  function fail(err) {
    main.innerHTML = '<p class="error">Sorry, this page could not load. ' + esc(err.message || err) + "</p>";
  }

  // ------------------------------------------------------------------ report pieces
  function sectionByKey(d, key) {
    for (var i = 0; i < d.sections.length; i++) if (d.sections[i].key === key) return d.sections[i];
    return { items: [], empty: "No data yet.", unit: null };
  }
  function cleanTitle(t) { return t.replace(/^Top \d+ /, "").replace(/\s*\(.*\)$/, "").replace(/^./, function (c) { return c.toUpperCase(); }); }

  // A ranked list with a bar next to each repo. metric: "gain" | "stars" | "forks".
  function list(s, opts) {
    opts = opts || {};
    if (!s.items.length) return '<p class="empty">' + esc(s.empty) + "</p>";
    var metric = opts.metric || (s.unit ? "gain" : "stars");
    var max = Math.max.apply(null, s.items.map(function (it) { return it[metric] || 0; }));
    var colour = opts.colour || (s.unit === "forks" ? "green" : "");
    return s.items.map(function (it, i) {
      var v = it[metric] || 0;
      var label = metric === "gain" ? "+" + fmt(v) : (metric === "forks" ? "⑂ " : "★ ") + fmt(v);
      return '<div class="entry' + (opts.compact ? " compact" : "") + '"><span class="rank">' + (i + 1) + "</span>" +
        '<div class="body"><div class="line"><a class="repo" href="' + gh(it.name) + '">' +
        esc(opts.compact ? it.name.split("/")[1] : it.name) + "</a>" +
        '<span class="num' + (colour ? " " + colour : "") + '">' + label + "</span></div>" +
        '<div class="bar' + (colour ? " " + colour : "") + '"><div style="width:' + pct(v, max) + '%"></div></div>' +
        (opts.desc && it.desc ? '<span class="desc">' + esc(it.desc) + "</span>" : "") +
        "</div></div>";
    }).join("");
  }

  function lead(d) {
    var s = sectionByKey(d, "climb_stars");
    var span = d.mode === "weekly" ? "this week" : "in 24 hours";
    if (!s.items.length) {
      return '<article class="lead"><span class="kicker">' + esc(d.title) + "</span>" +
        "<h1>" + esc(longDate(d.date)) + "</h1><p>" + esc(d.note) + "</p></article>";
    }
    var top = s.items[0];
    var name = top.name.split("/")[1];
    var others = s.items.slice(1, 3).map(function (it) {
      return '<a href="' + gh(it.name) + '">' + esc(it.name.split("/")[1]) + "</a> (+" + fmt(it.gain) + ")";
    });
    return '<article class="lead"><span class="kicker">Top climber · +' + fmt(top.gain) + " stars " + span + "</span>" +
      "<h1>" + esc(name) + " gains " + fmt(top.gain) + " stars " + (d.mode === "weekly" ? "this week" : "in a day") + "</h1>" +
      '<p><a href="' + gh(top.name) + '">' + esc(top.name) + "</a> now has " + fmt(top.stars) + " stars." +
      (top.desc ? " " + esc(top.desc.replace(/\s+$/, "")) + (/[.!?]$/.test(top.desc.trim()) ? "" : ".") : "") +
      (others.length ? " Also climbing: " + others.join(" and ") + "." : "") + "</p>" +
      '<span class="meta">' + esc(d.note) + "</span></article>";
  }

  function interestsGrid(d) {
    return '<div class="section-head"><h3>Editor\'s Interests · top 5 by stars</h3>' +
      '<a href="interests.html' + (param("r") ? "?r=" + encodeURIComponent(param("r")) : "") + '">All interests →</a></div>' +
      '<div class="grid4">' + d.topics.map(function (t) {
        var max = Math.max.apply(null, t.top.items.map(function (it) { return it.stars; }).concat([1]));
        var c = t.climb.items[0];
        return '<section><span class="kicker">' + esc(t.label) + "</span>" +
          (t.top.items.length ? t.top.items.map(function (it) {
            return '<div class="mini"><div class="line"><a href="' + gh(it.name) + '">' + esc(it.name.split("/")[1]) +
              "</a><span>★ " + short(it.stars) + '</span></div><div class="bar thin leaf"><div style="width:' +
              pct(it.stars, max) + '%"></div></div></div>';
          }).join("") : '<p class="empty">' + esc(t.top.empty) + "</p>") +
          '<span class="note">' + (c ? "Climbing: " + esc(c.name.split("/")[1]) + ", +" + fmt(c.gain) : "No star gains " + (d.mode === "weekly" ? "this week" : "today")) +
          "</span></section>";
      }).join("") + "</div>";
  }

  function pager(idx, d, target) {
    var same = idx.reports.filter(function (r) { return target === "any" || r.mode === d.mode; });
    var i = same.findIndex(function (r) { return r.file === d.date + "-" + d.mode + ".json"; });
    var older = same[i + 1], newer = same[i - 1];
    var base = d.mode === "weekly" ? "weekly.html" : "index.html";
    function link(r, txt) { return '<a href="' + base + "?r=" + encodeURIComponent(r.file) + '">' + txt + "</a>"; }
    return '<div class="pager">' + (older ? link(older, "‹ " + esc(day(older.date, { weekday: "short", day: "numeric", month: "short" }))) : "") +
      (newer ? link(newer, esc(day(newer.date, { weekday: "short", day: "numeric", month: "short" })) + " ›") : "") + "</div>";
  }

  function renderReport(d, idx) {
    var weekly = d.mode === "weekly";
    var html = '<div class="row">' + lead(d) +
      '<aside class="side"><h3 class="side-title">Climbing by forks</h3>' +
      list(sectionByKey(d, "climb_forks"), { compact: true }) + "</aside></div>";
    if (weekly) {
      html += '<div class="row">' +
        '<section class="col"><h3 class="col-title">All-time top 10 by stars</h3>' + list(sectionByKey(d, "all_stars"), { metric: "stars", desc: true }) + "</section>" +
        '<section class="col"><h3 class="col-title">All-time top 10 by forks</h3>' + list(sectionByKey(d, "all_forks"), { metric: "forks", colour: "green", desc: true }) + "</section></div>";
    }
    html += '<div class="row">' +
      '<section class="col"><h3 class="col-title">Climbing by stars</h3>' + list(sectionByKey(d, "climb_stars"), { desc: true }) + "</section>" +
      '<section class="col"><h3 class="col-title">Trending new repos</h3>' + list(sectionByKey(d, "trending"), { desc: true }) + "</section></div>";
    html += interestsGrid(d);
    html += '<div class="section-head">' + pager(idx, d) + "</div>";
    main.innerHTML = html;
    setDateline(longDate(d.date) + " · " + (weekly ? "Weekly summary" : "Daily report"));
    document.title = (weekly ? "Weekly summary" : "Daily report") + ", " + day(d.date, { day: "numeric", month: "long" }) + " · The Daily Index";
  }

  function renderInterests(d) {
    var span = d.mode === "weekly" ? "this week" : "since the day before";
    var html = '<section class="intro"><div style="display:flex;flex-direction:column;gap:8px"><span class="kicker">From the editor</span>' +
      "<h1>Editor's Interests</h1><p>Top 5 by stars among repos updated in the last 7 days, and the top 5 climbers " + span +
      ". From the " + esc(longDate(d.date)) + " report.</p></div>" +
      '<nav class="chips" aria-label="Jump to interest">' + d.topics.map(function (t) {
        return '<a href="#' + esc(t.slug) + '">#' + esc(t.slug) + "</a>";
      }).join("") + "</nav></section>";
    html += d.topics.map(function (t) {
      var c = t.climb.items[0];
      return '<section class="interest" id="' + esc(t.slug) + '"><div class="section-head" style="margin:0"><h2>#' + esc(t.slug) + "</h2>" +
        '<span class="sum">' + (c ? "biggest climber: " + esc(c.name) + " +" + fmt(c.gain) : "quiet: no star gains") + "</span></div>" +
        '<div style="display:flex;flex-wrap:wrap;gap:40px">' +
        '<div class="col" style="flex:3 1 520px"><h3 class="small">Top 5 by stars</h3>' + list(t.top, { metric: "stars", desc: true }) + "</div>" +
        '<div class="side" style="flex:2 1 340px"><h3 class="small">Top 5 climbing · ' + esc(d.period) + "</h3>" +
        list(t.climb, { compact: true, colour: "green" }) + "</div></div></section>";
    }).join("");
    main.innerHTML = html;
    setDateline(longDate(d.date));
  }

  function renderArchive(idx) {
    main.innerHTML = '<section class="intro"><div style="display:flex;flex-direction:column;gap:8px"><span class="kicker">Back issues</span>' +
      "<h1>Archive</h1><p>Every report so far, newest first.</p></div></section>" +
      '<ul class="archive">' + idx.reports.map(function (r) {
        var href = (r.mode === "weekly" ? "weekly.html" : "index.html") + "?r=" + encodeURIComponent(r.file);
        return '<li><a href="' + href + '">' + esc(longDate(r.date)) + '</a><span class="tag">' +
          (r.mode === "weekly" ? "WEEKLY SUMMARY" : "daily") + "</span></li>";
      }).join("") + "</ul>";
    setDateline(idx.reports.length + " reports");
  }

  function pickReport(idx, mode) {
    var r = param("r");
    if (r && /^\d{4}-\d{2}-\d{2}-(daily|weekly)\.json$/.test(r)) return r;
    var hit = idx.reports.filter(function (x) { return !mode || x.mode === mode; })[0] || idx.reports[0];
    if (!hit) throw new Error("There are no reports yet.");
    return hit.file;
  }

  // ------------------------------------------------------------------ live search
  var TYPES = {
    repositories: { label: "Repos", sorts: [["stars", "Most stars"], ["forks", "Most forks"], ["updated", "Recently updated"], ["best", "Best match"]] },
    users: { label: "People", sorts: [["followers", "Most followers"], ["repositories", "Most repos"], ["joined", "Newest"], ["best", "Best match"]] },
    issues: { label: "Issues", sorts: [["help", "Help wanted"], ["comments", "Most comments"], ["created", "Newest"], ["best", "Best match"]] }
  };

  function searchPage() {
    var st = {
      q: param("q") || "", type: TYPES[param("type")] ? param("type") : "repositories",
      sort: param("sort") || "", lang: param("lang") || "", n: ["10", "25", "50"].indexOf(param("n")) >= 0 ? param("n") : "10"
    };
    if (!TYPES[st.type].sorts.some(function (s) { return s[0] === st.sort; })) st.sort = TYPES[st.type].sorts[0][0];

    main.innerHTML =
      '<section class="search-box"><span class="kicker">Live search · straight from GitHub</span>' +
      '<form id="sf" role="search"><div class="q"><label for="q">What are you looking for?</label>' +
      '<input id="q" name="q" autocomplete="off" placeholder="e.g. ai agent"></div>' +
      '<button class="btn go" type="submit">Search</button></form>' +
      '<div class="controls"><div class="seg" id="types" role="group" aria-label="Search in"></div>' +
      '<div class="field"><label for="lang">Language</label><input id="lang" placeholder="any" list="langs">' +
      '<datalist id="langs"><option value="Python"><option value="JavaScript"><option value="TypeScript"><option value="Go"><option value="Rust"><option value="Java"><option value="C++"><option value="C#"><option value="Swift"><option value="Kotlin"></datalist></div>' +
      '<div class="field"><label for="n">Show</label><select id="n"><option value="10">Top 10</option><option value="25">Top 25</option><option value="50">Top 50</option></select></div></div>' +
      '<nav class="sorts" id="sorts" aria-label="Sort"></nav></section>' +
      '<div class="status" id="status"><span>Type a keyword and press Search.</span>' +
      "<span>Results come live from GitHub, separate from the daily report.</span></div>" +
      '<ol class="results" id="results"></ol>';

    var qEl = document.getElementById("q"), langEl = document.getElementById("lang"), nEl = document.getElementById("n");
    qEl.value = st.q; langEl.value = st.lang; nEl.value = st.n;

    function drawControls() {
      document.getElementById("types").innerHTML = Object.keys(TYPES).map(function (k) {
        return '<button type="button" data-type="' + k + '"' + (k === st.type ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + ">" + TYPES[k].label + "</button>";
      }).join("");
      document.getElementById("sorts").innerHTML = TYPES[st.type].sorts.map(function (s) {
        return '<button type="button" data-sort="' + s[0] + '"' + (s[0] === st.sort ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + ">" + s[1] + "</button>";
      }).join("");
    }
    drawControls();

    document.getElementById("types").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      st.type = b.getAttribute("data-type"); st.sort = TYPES[st.type].sorts[0][0]; drawControls(); run();
    });
    document.getElementById("sorts").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      st.sort = b.getAttribute("data-sort"); drawControls(); run();
    });
    nEl.addEventListener("change", function () { st.n = nEl.value; run(); });
    document.getElementById("sf").addEventListener("submit", function (e) { e.preventDefault(); run(); });

    var timer = null;
    function showLimit(rem, lim, reset) {
      var el = document.getElementById("limit"); if (!el) return;
      el.textContent = rem + " of " + lim + " searches left this minute";
      clearTimeout(timer);
      if (reset) timer = setTimeout(function () { el.textContent = lim + " of " + lim + " searches left this minute"; }, Math.max(0, reset * 1000 - Date.now()) + 500);
    }

    function run() {
      st.q = qEl.value.trim(); st.lang = langEl.value.trim(); st.n = nEl.value;
      var status = document.getElementById("status"), out = document.getElementById("results");
      var qs = new URLSearchParams();
      ["q", "type", "sort", "lang", "n"].forEach(function (k) { if (st[k]) qs.set(k, st[k]); });
      history.replaceState(null, "", "search.html?" + qs.toString());
      if (!st.q && !(st.type === "issues" && st.sort === "help")) {
        status.firstChild.textContent = "Type a keyword and press Search."; out.innerHTML = ""; return;
      }
      var q = st.q;
      if (st.lang) q += ' language:"' + st.lang.replace(/"/g, "") + '"';
      if (st.type === "issues") q += " is:issue is:open" + (st.sort === "help" ? ' label:"help wanted"' : "");
      var sort = st.sort === "best" ? "" : st.sort === "help" ? "updated" : st.sort;
      var url = "https://api.github.com/search/" + st.type + "?q=" + encodeURIComponent(q.trim()) +
        (sort ? "&sort=" + sort + "&order=desc" : "") + "&per_page=" + st.n;
      status.firstChild.textContent = "Searching GitHub…";
      fetch(url, { headers: { Accept: "application/vnd.github+json" } }).then(function (r) {
        var rem = r.headers.get("x-ratelimit-remaining"), lim = r.headers.get("x-ratelimit-limit"), reset = r.headers.get("x-ratelimit-reset");
        if (rem !== null) showLimit(rem, lim, Number(reset));
        if (r.status === 403 || r.status === 429) {
          var wait = reset ? Math.max(1, Math.round(Number(reset) - Date.now() / 1000)) : 60;
          throw new Error("GitHub's limit of " + (lim || 10) + " searches a minute was reached. Try again in " + wait + " seconds.");
        }
        if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.message || "GitHub returned " + r.status); });
        return r.json();
      }).then(function (data) {
        var items = data.items || [];
        var sortName = TYPES[st.type].sorts.filter(function (s) { return s[0] === st.sort; })[0][1].toLowerCase();
        status.firstChild.innerHTML = "Top " + items.length + " of " + fmt(data.total_count) + " " + TYPES[st.type].label.toLowerCase() +
          (st.q ? " for <strong>" + esc(st.q) + "</strong>" : "") + ", sorted by <strong>" + esc(sortName) + "</strong>" +
          (data.incomplete_results ? " (GitHub returned partial results)" : "");
        out.innerHTML = items.length ? items.map(rows[st.type]).join("") : '<li><p class="empty">Nothing found. Try a different keyword.</p></li>';
      }).catch(function (err) {
        status.firstChild.textContent = err.message; out.innerHTML = "";
      });
    }

    var rows = {
      repositories: function (it, i, all) {
        var metric = st.sort === "forks" ? "forks_count" : "stargazers_count";
        var max = Math.max.apply(null, all.map(function (x) { return x[metric]; }));
        return '<li><span class="rank">' + (i + 1) + '</span><div class="body"><div class="line">' +
          '<a class="title" href="' + esc(it.html_url) + '">' + esc(it.full_name) + "</a>" +
          '<span class="stats">★ ' + short(it.stargazers_count) + " · ⑂ " + short(it.forks_count) +
          (it.language ? " · " + esc(it.language) : "") + " · " + ago(it.pushed_at || it.updated_at) + "</span></div>" +
          '<div class="bar' + (metric === "forks_count" ? " green" : "") + '"><div style="width:' + pct(it[metric], max) + '%"></div></div>' +
          (it.description ? '<span class="desc">' + esc(it.description) + "</span>" : "") + "</div></li>";
      },
      users: function (it, i) {
        return '<li><span class="rank">' + (i + 1) + '</span><div class="body"><div class="who">' +
          '<img src="' + esc(it.avatar_url) + '&s=80" alt="" width="40" height="40" loading="lazy">' +
          '<a class="title" href="' + esc(it.html_url) + '">' + esc(it.login) + "</a></div>" +
          '<span class="desc">' + (it.type === "Organization" ? "Organisation" : "Person") + "</span></div></li>";
      },
      issues: function (it, i) {
        var repo = (it.repository_url || "").split("/").slice(-2).join("/");
        return '<li><span class="rank">' + (i + 1) + '</span><div class="body"><div class="line">' +
          '<a class="title" href="' + esc(it.html_url) + '">' + esc(it.title) + "</a>" +
          '<span class="stats">' + fmt(it.comments) + " comments · opened " + ago(it.created_at) + "</span></div>" +
          '<span class="desc"><a href="' + gh(repo) + '">' + esc(repo) + "</a>" +
          (it.labels && it.labels.length ? " · " + it.labels.slice(0, 4).map(function (l) { return esc(l.name); }).join(", ") : "") +
          "</span></div></li>";
      }
    };

    if (st.q || (st.type === "issues" && st.sort === "help")) run();
  }

  // ------------------------------------------------------------------ start
  shell("");
  if (page === "search") {
    setDateline(longDate(new Date().toISOString().slice(0, 10)));
    searchPage();
    return;
  }
  main.innerHTML = '<p class="loading">Loading the latest edition…</p>';
  getJSON(DATA + "index.json").then(function (idx) {
    if (page === "archive") return renderArchive(idx);
    var file = pickReport(idx, page === "weekly" ? "weekly" : page === "today" ? "daily" : null);
    return getJSON(DATA + file).then(function (d) {
      if (page === "interests") renderInterests(d); else renderReport(d, idx);
    });
  }).catch(fail);
})();
