/* No Brand Baseball - Face ID / Touch ID sign-in (native app only).
   Uses the NativeBiometric Capacitor plugin. On the web this is simply unavailable. */
window.NBB_BIO = (function () {
  'use strict';
  var SERVER = 'nobrandbaseball.app';
  var KEY = 'nbb.bio';

  function plugin() {
    var C = window.Capacitor;
    return (C && C.Plugins && C.Plugins.NativeBiometric) || null;
  }
  function isNative() {
    var C = window.Capacitor;
    try { return !!(C && C.isNativePlatform && C.isNativePlatform()); } catch (e) { return false; }
  }
  function labelFor(r) {
    var t = r && r.biometryType;
    if (t === 2 || t === 4 || t === 'FACE_ID' || t === 'FACE_AUTHENTICATION') return 'Face ID';
    if (t === 1 || t === 'TOUCH_ID') return 'Touch ID';
    if (t === 3 || t === 'FINGERPRINT') return 'fingerprint';
    return 'Face ID';
  }
  async function available() {
    var p = plugin();
    if (!p || !isNative()) return null;
    try {
      var r = await p.isAvailable({ useFallback: true });
      return (r && r.isAvailable) ? { label: labelFor(r), raw: r } : null;
    } catch (e) { return null; }
  }
  function pref() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  function setPref(v) { try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); } catch (e) {} }

  // Keychain item protected by biometry (plugin AccessControl.BIOMETRY_ANY = 2): only Face ID / Touch ID can read it back.
  var PROTECTED = 2;

  // Confirm identity, then keep the login in the device keychain behind biometry.
  async function enable(kind, username, password, label, displayName) {
    var p = plugin(); if (!p) throw new Error('Not available on this device.');
    await p.verifyIdentity({ reason: 'Turn on ' + label + ' for No Brand Baseball', title: 'No Brand Baseball', useFallback: true });
    try { await p.deleteCredentials({ server: SERVER }); } catch (e) {}
    await p.setCredentials({ username: username, password: password, server: SERVER, accessControl: PROTECTED });
    setPref({ kind: kind, label: label, name: displayName || username });
  }
  // Prompt Face ID / Touch ID and return the stored login.
  async function unlock(label) {
    var p = plugin(); if (!p) throw new Error('Not available on this device.');
    var c = null;
    try {
      c = await p.getSecureCredentials({ server: SERVER, reason: 'Sign in to No Brand Baseball', title: 'No Brand Baseball' });
    } catch (e) {
      var msg = String(e && e.message || e);
      if (/cancel/i.test(msg)) throw e;
      // Login saved before protected storage existed: verify, read the plain item, and upgrade it.
      await p.verifyIdentity({ reason: 'Sign in to No Brand Baseball', title: 'No Brand Baseball', useFallback: true });
      c = await p.getCredentials({ server: SERVER });
      if (c && c.username) {
        try { await p.deleteCredentials({ server: SERVER }); await p.setCredentials({ username: c.username, password: c.password, server: SERVER, accessControl: PROTECTED }); } catch (e2) {}
      }
    }
    if (!c || !c.username) throw new Error('No saved login. Sign in once, then turn ' + (label || 'Face ID') + ' back on.');
    return c;
  }
  async function disable() {
    var p = plugin();
    try { if (p) await p.deleteCredentials({ server: SERVER }); } catch (e) {}
    setPref(null);
  }

  return { isNative: isNative, available: available, pref: pref, setPref: setPref, enable: enable, unlock: unlock, disable: disable };
})();
