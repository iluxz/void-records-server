/* global window */
// Drop this into any project that wants the void records shelf.
// <script src="http://127.0.0.1:8787/vr-client.js"></script>
// Audio elements MUST use crossorigin="anonymous" or Web Audio sees a tainted
// media element and createMediaElementSource() silently outputs silence.
(function (global) {
  'use strict';

  var BASE = (global.VR_SERVER || 'http://127.0.0.1:8787').replace(/\/$/, '');

  async function request(url, options) {
    var response = await fetch(BASE + url, options);
    var body = await response.json();
    if (!response.ok) throw new Error(body.error || ('vr-server ' + response.status));
    return body;
  }

  function audioUrl(file) { return BASE + '/audio/' + encodeURIComponent(file); }

  global.VR = {
    base: BASE,
    health: function () { return request('/health'); },
    manifest: function () { return request('/api/v1/manifest').then(function (r) { return r.tracks; }); },
    meta: function () { return request('/api/v1/manifest'); },
    track: function (file) { return request('/api/v1/tracks/' + encodeURIComponent(file)); },
    audioUrl: audioUrl,
    lyrics: function (file, duration, extra) {
      var query = new URLSearchParams(Object.assign({ file: file, duration: duration }, extra || {}));
      return request('/api/v1/lyrics?' + query.toString());
    },
    random: function (options) {
      return request('/api/v1/random?' + new URLSearchParams(options || {}).toString())
        .then(function (r) { return r.picked; });
    },
    getState: function (client) { return request('/api/v1/state/' + encodeURIComponent(client)); },
    patchState: function (client, patch) {
      return request('/api/v1/state/' + encodeURIComponent(client), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });
    },
    putState: function (client, state) {
      return request('/api/v1/state/' + encodeURIComponent(client), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state)
      });
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
