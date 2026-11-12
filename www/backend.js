/* No Brand Baseball - backend wrapper (Supabase).
   Everything here degrades gracefully: when config.js is empty, enabled() is false and the
   app runs reports-only. Pitcher accounts use a derived login (id + first name) so the
   two-field sign-in stays the same for players; coaches sign in with a real email + password. */
window.NBB_BACKEND = (function () {
  'use strict';

  var cfg = window.NBB_CONFIG || {};
  var client = null;
  var BUCKET = 'assessments';
  var MAX_MB = Number(cfg.maxVideoMB) > 0 ? Number(cfg.maxVideoMB) : 50;
  var MAX_BYTES = MAX_MB * 1024 * 1024;
  var MAX_HINT = MAX_MB >= 200 ? 'about two minutes' : 'about 30 seconds at normal quality';

  function enabled() {
    return !!(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase && window.supabase.createClient);
  }

  function sb() {
    if (!enabled()) return null;
    if (!client) {
      client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
      });
    }
    return client;
  }

  function fail(e) {
    var msg = (e && e.message) ? e.message : String(e);
    throw new Error(msg);
  }

  function pitcherCreds(p) {
    var first = String(p.first || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return { email: p.id + '@pitchers.nobrandbaseball.app', password: 'nbb-' + p.id + '-' + first };
  }

  async function session() {
    var c = sb(); if (!c) return null;
    var r = await c.auth.getSession();
    return r.data ? r.data.session : null;
  }

  async function myProfile() {
    var c = sb(); var s = await session();
    if (!c || !s) return null;
    var r = await c.from('profiles').select('*').eq('user_id', s.user.id).maybeSingle();
    if (r.error) fail(r.error);
    return r.data;
  }

  async function signInPitcher(p) {
    var c = sb(); if (!c) return null;
    var r = await c.auth.signInWithPassword(pitcherCreds(p));
    if (r.error) fail(r.error);
    return r.data.user;
  }

  async function signInCoach(email, password) {
    var c = sb(); if (!c) fail('The backend is not set up yet.');
    var r = await c.auth.signInWithPassword({ email: email, password: password });
    if (r.error) fail(r.error);
    var prof = await myProfile();
    if (!prof || prof.role !== 'coach') {
      await c.auth.signOut();
      fail('That account is not a coach account.');
    }
    return prof;
  }

  async function signOut() {
    var c = sb(); if (c) { try { await c.auth.signOut(); } catch (e) {} }
  }

  // ---------- assessments ----------
  async function listAssessments(pitcherId) {
    var c = sb();
    var q = c.from('assessments').select('*').order('created_at', { ascending: false });
    if (pitcherId) q = q.eq('pitcher_id', pitcherId);
    var r = await q; if (r.error) fail(r.error);
    return r.data || [];
  }

  async function uploadAssessment(p, file, note) {
    var c = sb(); if (!c) fail('The backend is not set up yet.');
    if (file.size > MAX_BYTES) {
      fail('That video is ' + Math.round(file.size / 1048576) + ' MB. Please keep it under ' + MAX_MB + ' MB (' + MAX_HINT + ').');
    }
    var ext = (file.name && file.name.indexOf('.') > -1) ? file.name.split('.').pop() : ((file.type || '').split('/')[1] || 'mp4');
    ext = String(ext).toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
    var stamp = new Date().toISOString().replace(/[:.]/g, '-');
    var path = p.id + '/' + stamp + '.' + ext;
    var up = await c.storage.from(BUCKET).upload(path, file, { contentType: file.type || 'video/mp4', upsert: false });
    if (up.error) fail(up.error);
    var s = await session();
    var ins = await c.from('assessments').insert({
      pitcher_id: p.id, user_id: s.user.id, storage_path: path,
      note: note || null, size_bytes: file.size, content_type: file.type || null
    }).select().single();
    if (ins.error) fail(ins.error);
    return ins.data;
  }

  async function videoUrl(path) {
    var c = sb();
    var r = await c.storage.from(BUCKET).createSignedUrl(path, 3600);
    if (r.error) fail(r.error);
    return r.data.signedUrl;
  }

  async function reviewAssessment(id, coachNote) {
    var c = sb();
    var r = await c.from('assessments').update({ reviewed_at: new Date().toISOString(), coach_note: coachNote || null })
      .eq('id', id).select().single();
    if (r.error) fail(r.error);
    return r.data;
  }

  // ---------- messages ----------
  async function listMessages(pitcherId) {
    var c = sb();
    var r = await c.from('messages').select('*').eq('pitcher_id', pitcherId).order('created_at', { ascending: true });
    if (r.error) fail(r.error);
    return r.data || [];
  }

  async function sendMessage(pitcherId, body, role, senderName) {
    var c = sb(); var s = await session();
    var r = await c.from('messages').insert({
      pitcher_id: pitcherId, sender_user_id: s.user.id, sender_role: role, sender_name: senderName || null,
      body: body, read_by_coach: role === 'coach', read_by_pitcher: role === 'pitcher'
    }).select().single();
    if (r.error) fail(r.error);
    return r.data;
  }

  async function markRead(pitcherId, role) {
    var c = sb();
    var col = role === 'coach' ? 'read_by_coach' : 'read_by_pitcher';
    var other = role === 'coach' ? 'pitcher' : 'coach';
    var patch = {}; patch[col] = true;
    var r = await c.from('messages').update(patch).eq('pitcher_id', pitcherId).eq('sender_role', other).eq(col, false);
    if (r.error) fail(r.error);
  }

  async function unreadForPitcher(pitcherId) {
    var c = sb();
    var r = await c.from('messages').select('id', { count: 'exact', head: true })
      .eq('pitcher_id', pitcherId).eq('sender_role', 'coach').eq('read_by_pitcher', false);
    return r.error ? 0 : (r.count || 0);
  }

  async function coachOverview() {
    var c = sb();
    var r = await c.rpc('coach_overview');
    if (r.error) fail(r.error);
    return r.data || [];
  }

  return {
    enabled: enabled, session: session, myProfile: myProfile,
    signInPitcher: signInPitcher, signInCoach: signInCoach, signOut: signOut,
    listAssessments: listAssessments, uploadAssessment: uploadAssessment, videoUrl: videoUrl, reviewAssessment: reviewAssessment,
    listMessages: listMessages, sendMessage: sendMessage, markRead: markRead, unreadForPitcher: unreadForPitcher,
    coachOverview: coachOverview, MAX_BYTES: MAX_BYTES, MAX_MB: MAX_MB, MAX_HINT: MAX_HINT
  };
})();
