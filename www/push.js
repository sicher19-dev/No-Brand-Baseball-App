/* No Brand Baseball - push notifications (native app only).
   Uses @capacitor/push-notifications. On iOS the token is the raw APNs device token; the Supabase
   edge function in supabase/functions/push sends to it. Nothing here runs in a plain browser. */
window.NBB_PUSH = (function () {
  'use strict';
  var KEY = 'nbb.push.token';
  var bound = false;

  function plugin() {
    var C = window.Capacitor;
    if (!C || !C.isNativePlatform || !C.isNativePlatform()) return null;
    return (C.Plugins && C.Plugins.PushNotifications) || null;
  }
  function platform() { var C = window.Capacitor; return (C && C.getPlatform) ? C.getPlatform() : 'web'; }

  // register(token, platform) stores the device for the signed-in user; onOpen(hash) runs when a notification is tapped.
  async function enable(register, onOpen) {
    var P = plugin(); if (!P) return false;
    var perm = await P.checkPermissions();
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') perm = await P.requestPermissions();
    if (perm.receive !== 'granted') return false;
    if (!bound) {
      bound = true;
      P.addListener('registration', function (t) {
        try { localStorage.setItem(KEY, t.value); } catch (e) {}
        register(t.value, platform()).catch(function (e) { console.warn('device registration failed', e && e.message); });
      });
      P.addListener('registrationError', function (e) { console.warn('push registration error', JSON.stringify(e)); });
      P.addListener('pushNotificationActionPerformed', function (a) {
        var d = a && a.notification && a.notification.data;
        if (d && d.hash && onOpen) onOpen(String(d.hash));
      });
    }
    await P.register();
    return true;
  }

  // Forget this device for the user who is signing out.
  async function disable(unregister) {
    var token = null;
    try { token = localStorage.getItem(KEY); localStorage.removeItem(KEY); } catch (e) {}
    if (token) { try { await unregister(token); } catch (e) {} }
  }

  return { enable: enable, disable: disable, available: function () { return !!plugin(); } };
})();
