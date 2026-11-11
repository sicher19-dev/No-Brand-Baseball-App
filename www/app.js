/* No Brand Baseball - pitcher portal
   Login: username = last name, password = first name (first pass; case-insensitive).
   Roster lives in roster.js (bundled) and is refreshed from the live site on launch. */
(function () {
  'use strict';

  var LIVE_ROSTER_URL = 'https://sicher19-dev.github.io/No-Brand-Baseball-App/roster.js';
  var STORE_KEY = 'nbb.session';

  var KIND_LABEL = {
    scout: 'Scouting Reports', reverse: 'Reverse Reports', grades: 'Pitch Grades',
    picture: 'Full Picture', execution: 'Execution', player: 'Player Report',
    zone: 'Zone Usage', lab: 'Labs & Tools', snapshot: '2026 Season Snapshot'
  };
  var KIND_ORDER = ['scout', 'reverse', 'grades', 'execution', 'picture', 'player', 'zone', 'snapshot', 'lab'];
  var KIND_ICO = {
    scout: 'SCT', reverse: 'REV', grades: 'GRD', picture: 'PIC', execution: 'EXE',
    player: 'PLR', zone: 'ZON', lab: 'LAB', snapshot: 'PDF'
  };

  var roster = window.NBB_ROSTER || { updated: '', pitchers: [] };
  var session = null;

  var $ = function (id) { return document.getElementById(id); };
  var views = { login: $('view-login'), home: $('view-home'), report: $('view-report') };

  function show(name) {
    Object.keys(views).forEach(function (k) { views[k].hidden = (k !== name); });
    window.scrollTo(0, 0);
  }

  // ---------- roster ----------
  // Load the live roster.js as a <script> (works from GitHub Pages, the native app and local files alike).
  var refreshing = null;
  function refreshRoster() {
    if (refreshing) return refreshing;
    refreshing = new Promise(function (resolve) {
      var before = window.NBB_ROSTER;
      var s = document.createElement('script');
      var done = false;
      function finish(ok) {
        if (done) return; done = true;
        refreshing = null;
        if (s.parentNode) s.parentNode.removeChild(s);
        var live = window.NBB_ROSTER;
        if (ok && live && live !== before && live.pitchers && (live.updated || '') >= (roster.updated || '')) {
          roster = live;
          resolve(true);
        } else {
          window.NBB_ROSTER = before;
          resolve(false);
        }
      }
      s.src = LIVE_ROSTER_URL + '?t=' + Date.now();
      s.async = true;
      s.onload = function () { finish(true); };
      s.onerror = function () { finish(false); };
      setTimeout(function () { finish(false); }, 6000);
      document.head.appendChild(s);
    });
    return refreshing;
  }

  function findPitcher(username, password) {
    var u = (username || '').trim().toLowerCase();
    var p = (password || '').trim().toLowerCase();
    var matches = roster.pitchers.filter(function (x) {
      return (x.username || x.last).toLowerCase() === u;
    });
    for (var i = 0; i < matches.length; i++) {
      var ok = [matches[i].first].concat(matches[i].aliases || []);
      for (var j = 0; j < ok.length; j++) {
        if (ok[j].toLowerCase() === p) return matches[i];
      }
    }
    return null;
  }

  function pitcherById(id) {
    for (var i = 0; i < roster.pitchers.length; i++) if (roster.pitchers[i].id === id) return roster.pitchers[i];
    return null;
  }

  // ---------- session ----------
  function saveSession(p) {
    session = { id: p.id, first: p.first, last: p.last };
    try { localStorage.setItem(STORE_KEY, JSON.stringify(session)); } catch (e) {}
  }
  function loadSession() {
    try { session = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { session = null; }
    return session;
  }
  function clearSession() {
    session = null;
    try { localStorage.removeItem(STORE_KEY); } catch (e) {}
  }

  // ---------- rendering ----------
  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso + 'T12:00:00');
    if (isNaN(d)) return iso;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function renderHome(p) {
    $('player-name').textContent = p.first + ' ' + p.last;
    var chips = [];
    if (p.org) chips.push('<span class="chip"><b>' + esc(p.org) + '</b></span>');
    if (p.level) chips.push('<span class="chip">' + esc(p.level) + '</span>');
    if (p.role) chips.push('<span class="chip">' + esc(p.role) + '</span>');
    if (p.hand) chips.push('<span class="chip">' + esc(p.hand) + '</span>');
    $('player-chips').innerHTML = chips.join('');

    var reports = (p.reports || []).slice();
    reports.sort(function (a, b) { return (b.updated || '').localeCompare(a.updated || ''); });

    // Hero: latest scouting report (or latest anything)
    var hero = reports.filter(function (r) { return r.kind === 'scout'; })[0] || reports[0];
    var heroEl = $('hero');
    if (hero) {
      heroEl.innerHTML =
        '<a class="hero" href="#/r/' + esc(hero.id) + '">' +
          '<div class="hero-kicker">' + (hero.kind === 'scout' ? 'Latest Scouting Report' : 'Latest Report') + '</div>' +
          '<div class="hero-title">' + esc(hero.title) + '</div>' +
          '<div class="hero-meta mono">Updated ' + esc(fmtDate(hero.updated)) + '</div>' +
          '<span class="hero-cta">Open report &rarr;</span>' +
        '</a>';
    } else {
      heroEl.innerHTML = '';
    }

    // Groups
    var groups = {};
    reports.forEach(function (r) { (groups[r.kind] = groups[r.kind] || []).push(r); });
    var html = '';
    KIND_ORDER.forEach(function (k) {
      var list = groups[k];
      if (!list || !list.length) return;
      html += '<section class="group"><div class="group-title"><span>' + esc(KIND_LABEL[k] || k) +
              '</span><span class="c">' + list.length + '</span></div>';
      list.forEach(function (r) {
        html += '<a class="card" href="#/r/' + esc(r.id) + '">' +
                  '<div class="card-ico">' + (KIND_ICO[r.kind] || 'RPT') + '</div>' +
                  '<div class="card-body"><div class="card-title">' + esc(r.title) + '</div>' +
                  '<div class="card-meta">' + esc(fmtDate(r.updated)) + (r.note ? ' &middot; ' + esc(r.note) : '') + '</div></div>' +
                  '<div class="card-arrow">&#8250;</div>' +
                '</a>';
      });
      html += '</section>';
    });
    $('report-groups').innerHTML = html;
    $('empty').hidden = reports.length > 0;
  }

  function openReport(id) {
    var p = session && pitcherById(session.id);
    if (!p) { location.hash = '#/login'; return; }
    var r = (p.reports || []).filter(function (x) { return x.id === id; })[0];
    if (!r) { location.hash = '#/home'; return; }
    $('viewer-title').textContent = r.title;
    $('viewer-ext').href = r.url;
    var frame = $('viewer-frame');
    var loading = $('viewer-loading');
    loading.hidden = false;
    frame.onload = function () { loading.hidden = true; };
    frame.src = r.url;
    show('report');
  }

  // ---------- routing ----------
  function route() {
    var h = location.hash || '';
    if (!session) loadSession();
    if (session && !pitcherById(session.id)) clearSession();

    if (h.indexOf('#/r/') === 0 && session) { openReport(decodeURIComponent(h.slice(4))); return; }
    if (session) {
      $('viewer-frame').src = 'about:blank';
      renderHome(pitcherById(session.id));
      show('home');
      if (h !== '#/home') history.replaceState(null, '', '#/home');
      return;
    }
    show('login');
    if (h !== '#/login') history.replaceState(null, '', '#/login');
  }

  // ---------- events ----------
  $('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = $('login-btn'), err = $('login-error');
    err.hidden = true;
    btn.disabled = true; btn.textContent = 'Signing in…';
    refreshRoster().then(function () {
      var p = findPitcher($('login-user').value, $('login-pass').value);
      btn.disabled = false; btn.textContent = 'Sign in';
      if (!p) {
        err.textContent = 'That username and password did not match. Username is your last name, password is your first name.';
        err.hidden = false;
        return;
      }
      saveSession(p);
      $('login-pass').value = '';
      location.hash = '#/home';
      route();
    });
  });

  $('signout').addEventListener('click', function () {
    clearSession();
    location.hash = '#/login';
    route();
  });

  $('back').addEventListener('click', function () {
    if (history.length > 1) history.back(); else location.hash = '#/home';
  });

  window.addEventListener('hashchange', route);

  // Refresh the roster whenever the app comes back to the foreground
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && session && !views.home.hidden) {
      refreshRoster().then(function (changed) { if (changed) renderHome(pitcherById(session.id)); });
    }
  });

  // ---------- boot ----------
  $('roster-stamp').textContent = 'reports as of ' + (roster.updated || '-');
  route();
  refreshRoster().then(function (changed) {
    $('roster-stamp').textContent = 'reports as of ' + (roster.updated || '-');
    if (changed && session && !views.home.hidden) renderHome(pitcherById(session.id));
  });

  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
