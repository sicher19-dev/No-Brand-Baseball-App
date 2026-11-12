/* No Brand Baseball - pitcher portal
   Pitchers: username = last name, password = first name (case-insensitive).
   Coaches: email + password (Coach sign in).
   Roster lives in roster.js and is refreshed from the live site on launch.
   Assessments + messages live in Supabase via backend.js (optional; see config.js). */
(function () {
  'use strict';

  var LIVE_ROSTER_URL = 'https://sicher19-dev.github.io/No-Brand-Baseball-App/roster.js';
  var STORE_KEY = 'nbb.session';
  var B = window.NBB_BACKEND;
  var CFG = window.NBB_CONFIG || {};
  var COACH_LABEL = CFG.coachLabel || 'the coaches';

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
  var session = null;          // { kind: 'pitcher', id, backend: bool } | { kind: 'coach', name, email }
  var pendingFile = null;      // video chosen but not yet sent
  var coachLoadedId = null;    // pitcher currently open in coach view

  var $ = function (id) { return document.getElementById(id); };
  var views = {
    login: $('view-login'), home: $('view-home'), report: $('view-report'),
    coach: $('view-coach'), coachPitcher: $('view-coach-pitcher')
  };

  function show(name) {
    Object.keys(views).forEach(function (k) { views[k].hidden = (k !== name); });
    window.scrollTo(0, 0);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function fmtWhen(iso) {
    var d = new Date(iso); if (isNaN(d)) return iso || '';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' +
           d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  function fmtMB(b) { return b ? (Math.round(b / 104857.6) / 10) + ' MB' : ''; }
  function setStatus(id, text, kind) {
    var el = $(id); if (!el) return;
    if (!text) { el.hidden = true; el.textContent = ''; el.className = 'status'; return; }
    el.hidden = false; el.textContent = text; el.className = 'status ' + (kind || '');
  }

  // ---------- roster ----------
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
          roster = live; resolve(true);
        } else {
          window.NBB_ROSTER = before; resolve(false);
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
    var matches = roster.pitchers.filter(function (x) { return (x.username || x.last).toLowerCase() === u; });
    for (var i = 0; i < matches.length; i++) {
      var ok = [matches[i].first].concat(matches[i].aliases || []);
      for (var j = 0; j < ok.length; j++) if (ok[j].toLowerCase() === p) return matches[i];
    }
    return null;
  }
  function pitcherById(id) {
    for (var i = 0; i < roster.pitchers.length; i++) if (roster.pitchers[i].id === id) return roster.pitchers[i];
    return null;
  }

  // ---------- session ----------
  function saveSession(s) { session = s; try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) {} }
  function loadSession() { try { session = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { session = null; } return session; }
  function clearSession() { session = null; try { localStorage.removeItem(STORE_KEY); } catch (e) {} }

  // =====================================================================
  // PITCHER HOME
  // =====================================================================
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

    var hero = reports.filter(function (r) { return r.kind === 'scout'; })[0] || reports[0];
    $('hero').innerHTML = hero ?
      '<a class="hero" href="#/r/' + esc(hero.id) + '">' +
        '<div class="hero-kicker">' + (hero.kind === 'scout' ? 'Latest Scouting Report' : 'Latest Report') + '</div>' +
        '<div class="hero-title">' + esc(hero.title) + '</div>' +
        '<div class="hero-meta mono">Updated ' + esc(fmtDate(hero.updated)) + '</div>' +
        '<span class="hero-cta">Open report &rarr;</span>' +
      '</a>' : '';

    var groups = {};
    reports.forEach(function (r) { (groups[r.kind] = groups[r.kind] || []).push(r); });
    var html = '';
    KIND_ORDER.forEach(function (k) {
      var list = groups[k]; if (!list || !list.length) return;
      html += '<section class="group"><div class="group-title"><span>' + esc(KIND_LABEL[k] || k) + '</span><span class="c">' + list.length + '</span></div>';
      list.forEach(function (r) {
        html += '<a class="card" href="#/r/' + esc(r.id) + '">' +
          '<div class="card-ico">' + (KIND_ICO[r.kind] || 'RPT') + '</div>' +
          '<div class="card-body"><div class="card-title">' + esc(r.title) + '</div>' +
          '<div class="card-meta">' + esc(fmtDate(r.updated)) + (r.note ? ' &middot; ' + esc(r.note) : '') + '</div></div>' +
          '<div class="card-arrow">&#8250;</div></a>';
      });
      html += '</section>';
    });
    $('report-groups').innerHTML = html;
    $('empty').hidden = reports.length > 0;

    // Backend-powered sections
    var on = !!(session && session.backend);
    $('assess-disabled').hidden = on; $('assess-enabled').hidden = !on;
    $('msg-disabled').hidden = on; $('msg-enabled').hidden = !on;
    $('coach-label-1').textContent = COACH_LABEL;
    $('msg-input').placeholder = 'Message ' + COACH_LABEL;
    if (on) { loadAssessments(p); loadThread(p); }
  }

  // ---------- assessments (pitcher) ----------
  function chooseFile(file) {
    if (!file) return;
    pendingFile = file;
    var v = $('assess-video');
    try { v.src = URL.createObjectURL(file); } catch (e) {}
    $('assess-meta').textContent = (file.name || 'video') + ' · ' + fmtMB(file.size);
    $('assess-preview').hidden = false;
    setStatus('assess-status', '');
    if (file.size > B.MAX_BYTES) setStatus('assess-status', 'This video is ' + fmtMB(file.size) + '. Keep it under 500 MB (about two minutes).', 'bad');
  }
  function cancelFile() {
    pendingFile = null;
    $('assess-preview').hidden = true;
    $('assess-video').removeAttribute('src');
    $('assess-note').value = '';
    $('assess-record').value = ''; $('assess-pick').value = '';
  }
  async function sendAssessment(p) {
    if (!pendingFile) return;
    var btn = $('assess-send');
    btn.disabled = true; btn.textContent = 'Uploading…';
    setStatus('assess-status', 'Uploading your video. This can take a minute on cellular; keep the app open.', 'info');
    try {
      await B.uploadAssessment(p, pendingFile, $('assess-note').value.trim());
      setStatus('assess-status', 'Sent. ' + COACH_LABEL + ' will take a look and reply here.', 'good');
      cancelFile();
      loadAssessments(p);
    } catch (e) {
      setStatus('assess-status', 'Upload failed: ' + e.message, 'bad');
    }
    btn.disabled = false; btn.textContent = 'Send to No Brand';
  }
  async function loadAssessments(p) {
    try {
      var rows = await B.listAssessments(p.id);
      $('assess-count').textContent = rows.length || '';
      $('assess-list').innerHTML = rows.length ? rows.map(function (a) {
        return '<div class="item">' +
          '<div class="item-head"><span class="item-title">' + esc(fmtWhen(a.created_at)) + '</span>' +
          '<span class="badge ' + (a.reviewed_at ? 'good' : '') + '">' + (a.reviewed_at ? 'Reviewed' : 'Received') + '</span></div>' +
          (a.note ? '<div class="item-text">' + esc(a.note) + '</div>' : '') +
          (a.coach_note ? '<div class="item-reply"><b>' + esc(COACH_LABEL) + ':</b> ' + esc(a.coach_note) + '</div>' : '') +
          '<div class="item-meta mono">' + esc(fmtMB(a.size_bytes)) + '</div>' +
        '</div>';
      }).join('') : '<div class="panel-text muted">No videos sent yet.</div>';
    } catch (e) {
      $('assess-list').innerHTML = '<div class="panel-text muted">Could not load assessments: ' + esc(e.message) + '</div>';
    }
  }

  // ---------- messages (pitcher) ----------
  function renderThread(el, msgs, myRole) {
    el.innerHTML = msgs.length ? msgs.map(function (m) {
      var mine = m.sender_role === myRole;
      var who = mine ? 'You' : (m.sender_name || (m.sender_role === 'coach' ? COACH_LABEL : 'Pitcher'));
      return '<div class="bubble ' + (mine ? 'me' : 'them') + '">' +
        '<div class="bubble-meta mono">' + esc(who) + ' · ' + esc(fmtWhen(m.created_at)) + '</div>' +
        '<div class="bubble-body">' + esc(m.body) + '</div></div>';
    }).join('') : '<div class="panel-text muted">No messages yet. Say hello.</div>';
    el.scrollTop = el.scrollHeight;
  }
  async function loadThread(p) {
    try {
      var msgs = await B.listMessages(p.id);
      renderThread($('msg-thread'), msgs, 'pitcher');
      $('msg-count').textContent = msgs.length || '';
      B.markRead(p.id, 'pitcher').catch(function () {});
    } catch (e) {
      $('msg-thread').innerHTML = '<div class="panel-text muted">Could not load messages: ' + esc(e.message) + '</div>';
    }
  }
  async function sendPitcherMessage(p) {
    var input = $('msg-input'); var body = input.value.trim(); if (!body) return;
    input.disabled = true;
    try {
      await B.sendMessage(p.id, body, 'pitcher', p.first + ' ' + p.last);
      input.value = '';
      await loadThread(p);
    } catch (e) { alert('Could not send: ' + e.message); }
    input.disabled = false;
  }

  // =====================================================================
  // REPORT VIEWER
  // =====================================================================
  function openReport(id) {
    var p = session && session.kind === 'pitcher' && pitcherById(session.id);
    if (!p) { location.hash = '#/login'; return; }
    var r = (p.reports || []).filter(function (x) { return x.id === id; })[0];
    if (!r) { location.hash = '#/home'; return; }
    $('viewer-title').textContent = r.title;
    $('viewer-ext').href = r.url;
    var frame = $('viewer-frame'); var loading = $('viewer-loading');
    loading.hidden = false;
    frame.onload = function () { loading.hidden = true; };
    frame.src = r.url;
    show('report');
  }

  // =====================================================================
  // COACH VIEW
  // =====================================================================
  async function renderCoach() {
    $('coach-name').textContent = session.name || 'Coach';
    setStatus('coach-status', 'Loading…', 'info');
    var overview = [];
    try { overview = await B.coachOverview(); setStatus('coach-status', ''); }
    catch (e) { setStatus('coach-status', 'Could not load activity: ' + e.message, 'bad'); }
    var byId = {};
    overview.forEach(function (o) { byId[o.pitcher_id] = o; });

    var all = roster.pitchers.filter(function (p) { return p.id !== 'demo'; });
    var attn = all.filter(function (p) { var o = byId[p.id]; return o && (Number(o.new_assessments) > 0 || Number(o.unread_messages) > 0); });
    attn.sort(function (a, b) { return String(byId[b.id].last_activity || '').localeCompare(String(byId[a.id].last_activity || '')); });

    function card(p) {
      var o = byId[p.id] || {};
      var badges = '';
      if (Number(o.new_assessments) > 0) badges += '<span class="badge">' + o.new_assessments + ' new video' + (o.new_assessments > 1 ? 's' : '') + '</span>';
      if (Number(o.unread_messages) > 0) badges += '<span class="badge gold">' + o.unread_messages + ' unread</span>';
      return '<a class="card" href="#/coach/' + esc(p.id) + '">' +
        '<div class="card-ico">' + esc((p.first[0] || '') + (p.last[0] || '')) + '</div>' +
        '<div class="card-body"><div class="card-title">' + esc(p.first + ' ' + p.last) + ' ' + badges + '</div>' +
        '<div class="card-meta">' + esc([p.org, p.level, p.role].filter(Boolean).join(' · ')) +
        (o.last_activity ? ' · last activity ' + esc(fmtWhen(o.last_activity)) : '') + '</div></div>' +
        '<div class="card-arrow">&#8250;</div></a>';
    }
    $('coach-attn').innerHTML = attn.length ? attn.map(card).join('') : '<div class="panel-text muted">Nothing waiting on you.</div>';
    $('coach-attn-count').textContent = attn.length || '';
    $('coach-all').innerHTML = all.map(card).join('');
    $('coach-all-count').textContent = all.length;
    var totalNew = overview.reduce(function (n, o) { return n + Number(o.new_assessments || 0); }, 0);
    var totalUnread = overview.reduce(function (n, o) { return n + Number(o.unread_messages || 0); }, 0);
    $('coach-summary').textContent = totalNew + ' new videos · ' + totalUnread + ' unread';
  }

  async function renderCoachPitcher(id) {
    var p = pitcherById(id); if (!p) { location.hash = '#/coach'; return; }
    coachLoadedId = id;
    $('cp-title').textContent = p.first + ' ' + p.last;
    $('cp-chips').innerHTML = [p.org, p.level, p.role, p.hand].filter(Boolean).map(function (x) { return '<span class="chip">' + esc(x) + '</span>'; }).join('');
    setStatus('cp-status', 'Loading…', 'info');
    try {
      var rows = await B.listAssessments(id);
      $('cp-assess-count').textContent = rows.length || '';
      $('cp-assess').innerHTML = rows.length ? rows.map(function (a) {
        return '<div class="item" data-id="' + esc(a.id) + '" data-path="' + esc(a.storage_path) + '">' +
          '<div class="item-head"><span class="item-title">' + esc(fmtWhen(a.created_at)) + '</span>' +
          '<span class="badge ' + (a.reviewed_at ? 'good' : 'gold') + '">' + (a.reviewed_at ? 'Reviewed' : 'New') + '</span></div>' +
          (a.note ? '<div class="item-text">' + esc(a.note) + '</div>' : '') +
          '<div class="item-meta mono">' + esc(fmtMB(a.size_bytes)) + ' · ' + esc(a.content_type || '') + '</div>' +
          '<div class="row"><button class="btn-ghost js-play" type="button">Play</button><a class="btn-ghost js-open" target="_blank" rel="noopener" href="#">Open / download</a></div>' +
          '<video class="cp-video" controls playsinline hidden></video>' +
          '<div class="review">' +
            '<textarea class="js-note" rows="2" placeholder="Note back to ' + esc(p.first) + ' (optional)">' + esc(a.coach_note || '') + '</textarea>' +
            '<button class="btn-primary js-review" type="button">' + (a.reviewed_at ? 'Update note' : 'Mark reviewed') + '</button>' +
          '</div>' +
        '</div>';
      }).join('') : '<div class="panel-text muted">No videos from ' + esc(p.first) + ' yet.</div>';
      var msgs = await B.listMessages(id);
      renderThread($('cp-thread'), msgs, 'coach');
      $('cp-msg-count').textContent = msgs.length || '';
      B.markRead(id, 'coach').catch(function () {});
      setStatus('cp-status', '');
    } catch (e) {
      setStatus('cp-status', 'Could not load: ' + e.message, 'bad');
    }
  }

  $('cp-assess').addEventListener('click', async function (e) {
    var item = e.target.closest('.item'); if (!item) return;
    var path = item.getAttribute('data-path'); var id = item.getAttribute('data-id');
    if (e.target.classList.contains('js-play')) {
      e.target.disabled = true;
      try {
        var url = await B.videoUrl(path);
        var v = item.querySelector('.cp-video'); v.src = url; v.hidden = false; v.play().catch(function () {});
        item.querySelector('.js-open').href = url;
      } catch (err) { alert('Could not load video: ' + err.message); }
      e.target.disabled = false;
    } else if (e.target.classList.contains('js-open')) {
      if (e.target.getAttribute('href') === '#') {
        e.preventDefault();
        try { var u = await B.videoUrl(path); e.target.href = u; window.open(u, '_blank'); } catch (err) { alert('Could not load video: ' + err.message); }
      }
    } else if (e.target.classList.contains('js-review')) {
      e.target.disabled = true;
      try { await B.reviewAssessment(id, item.querySelector('.js-note').value.trim()); await renderCoachPitcher(coachLoadedId); }
      catch (err) { alert('Could not save: ' + err.message); e.target.disabled = false; }
    }
  });

  $('cp-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var input = $('cp-input'); var body = input.value.trim(); if (!body || !coachLoadedId) return;
    input.disabled = true;
    try {
      await B.sendMessage(coachLoadedId, body, 'coach', session.name || 'Coach');
      input.value = '';
      var msgs = await B.listMessages(coachLoadedId);
      renderThread($('cp-thread'), msgs, 'coach');
    } catch (err) { alert('Could not send: ' + err.message); }
    input.disabled = false;
  });

  // =====================================================================
  // ROUTING
  // =====================================================================
  function route() {
    var h = location.hash || '';
    if (!session) loadSession();
    if (session && session.kind === 'pitcher' && !pitcherById(session.id)) clearSession();

    if (!session) {
      show('login');
      if (h !== '#/login') history.replaceState(null, '', '#/login');
      return;
    }
    if (session.kind === 'coach') {
      var m = h.match(/^#\/coach\/(.+)$/);
      if (m) { renderCoachPitcher(decodeURIComponent(m[1])); show('coachPitcher'); return; }
      renderCoach(); show('coach');
      if (h !== '#/coach') history.replaceState(null, '', '#/coach');
      return;
    }
    if (h.indexOf('#/r/') === 0) { openReport(decodeURIComponent(h.slice(4))); return; }
    $('viewer-frame').src = 'about:blank';
    renderHome(pitcherById(session.id));
    show('home');
    if (h !== '#/home') history.replaceState(null, '', '#/home');
  }

  // =====================================================================
  // EVENTS
  // =====================================================================
  var coachMode = false;
  $('login-mode').addEventListener('click', function () {
    coachMode = !coachMode;
    $('login-pitcher-fields').hidden = coachMode;
    $('login-coach-fields').hidden = !coachMode;
    $('login-mode').textContent = coachMode ? 'Pitcher sign in' : 'Coach sign in';
    $('login-error').hidden = true;
  });

  $('login-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var btn = $('login-btn'), err = $('login-error');
    err.hidden = true; btn.disabled = true; btn.textContent = 'Signing in…';
    try {
      if (coachMode) {
        if (!B.enabled()) throw new Error('Coach sign in is not set up yet.');
        var prof = await B.signInCoach($('login-email').value.trim(), $('login-coach-pass').value);
        saveSession({ kind: 'coach', name: prof.display_name || 'Coach', email: $('login-email').value.trim() });
        $('login-coach-pass').value = '';
        location.hash = '#/coach';
      } else {
        await refreshRoster();
        var p = findPitcher($('login-user').value, $('login-pass').value);
        if (!p) throw new Error('That username and password did not match. Username is your last name, password is your first name.');
        var backend = false;
        if (B.enabled()) {
          try { await B.signInPitcher(p); backend = true; } catch (be) { backend = false; }
        }
        saveSession({ kind: 'pitcher', id: p.id, backend: backend });
        $('login-pass').value = '';
        location.hash = '#/home';
      }
      route();
    } catch (ex) {
      err.textContent = ex.message; err.hidden = false;
    }
    btn.disabled = false; btn.textContent = 'Sign in';
  });

  async function doSignOut() {
    clearSession();
    try { await B.signOut(); } catch (e) {}
    location.hash = '#/login';
    route();
  }
  $('signout').addEventListener('click', doSignOut);
  $('coach-signout').addEventListener('click', doSignOut);
  $('coach-refresh').addEventListener('click', renderCoach);
  $('cp-refresh').addEventListener('click', function () { if (coachLoadedId) renderCoachPitcher(coachLoadedId); });
  $('coach-back').addEventListener('click', function () { location.hash = '#/coach'; });
  $('back').addEventListener('click', function () { if (history.length > 1) history.back(); else location.hash = '#/home'; });

  $('assess-record').addEventListener('change', function (e) { chooseFile(e.target.files && e.target.files[0]); });
  $('assess-pick').addEventListener('change', function (e) { chooseFile(e.target.files && e.target.files[0]); });
  $('assess-cancel').addEventListener('click', cancelFile);
  $('assess-send').addEventListener('click', function () { var p = pitcherById(session.id); if (p) sendAssessment(p); });
  $('msg-form').addEventListener('submit', function (e) { e.preventDefault(); var p = pitcherById(session.id); if (p) sendPitcherMessage(p); });

  window.addEventListener('hashchange', route);

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible' || !session) return;
    if (session.kind === 'pitcher' && !views.home.hidden) {
      refreshRoster().then(function (changed) { if (changed) renderHome(pitcherById(session.id)); });
      if (session.backend) { var p = pitcherById(session.id); if (p) { loadAssessments(p); loadThread(p); } }
    } else if (session.kind === 'coach') {
      if (!views.coach.hidden) renderCoach();
      if (!views.coachPitcher.hidden && coachLoadedId) renderCoachPitcher(coachLoadedId);
    }
  });

  // ---------- boot ----------
  $('roster-stamp').textContent = 'reports as of ' + (roster.updated || '-');
  loadSession();
  // If the backend session expired or was never established, retry quietly for pitchers.
  if (session && session.kind === 'pitcher' && B.enabled()) {
    B.session().then(function (s) {
      if (!s) { var p = pitcherById(session.id); if (p) return B.signInPitcher(p).then(function () { session.backend = true; saveSession(session); if (!views.home.hidden) renderHome(p); }); }
      else if (!session.backend) { session.backend = true; saveSession(session); }
    }).catch(function () {});
  }
  route();
  refreshRoster().then(function (changed) {
    $('roster-stamp').textContent = 'reports as of ' + (roster.updated || '-');
    if (changed && session && session.kind === 'pitcher' && !views.home.hidden) renderHome(pitcherById(session.id));
  });

  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
