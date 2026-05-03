(function () {
  "use strict";
  function encodeOne(v) {
    if (typeof v === "string") return v;
    try { return JSON.stringify(v); } catch (e) { return ""; }
  }
  function encode(state) {
    const params = new URLSearchParams();
    for (const k of Object.keys(state || {})) {
      try { params.set(k, encodeOne(state[k])); } catch (e) { /* skip bad key, keep others */ }
    }
    return params.toString();
  }
  function decode(qs) {
    const out = {};
    try {
      const p = new URLSearchParams(qs || location.search);
      for (const [k, v] of p) {
        try { out[k] = JSON.parse(v); } catch { out[k] = v; }
      }
    } catch (e) { }
    return out;
  }
  function save(state, opts) {
    const qs = encode(state || {});
    const url = location.pathname + (qs ? "?" + qs : "") + location.hash;
    try { (opts && opts.replace ? history.replaceState : history.pushState).call(history, null, "", url); } catch (e) { }
  }
  function load() { return decode(); }
  function clear() {
    try { history.replaceState(null, "", location.pathname + location.hash); } catch (e) { }
  }
  window.UrlState = { save, load, clear, encode, decode };
})();
