(function () {
  "use strict";
  const PREFIX = "autosave:";
  function key(name) { return PREFIX + (name || location.pathname); }
  function save(name, data) {
    try { localStorage.setItem(key(name), JSON.stringify({ t: Date.now(), data })); return true; }
    catch (e) { return false; }
  }
  function load(name) {
    try {
      const raw = localStorage.getItem(key(name));
      if (!raw) return null;
      const obj = JSON.parse(raw);
      return obj && "data" in obj ? obj.data : null;
    } catch (e) { return null; }
  }
  function clear(name) { try { localStorage.removeItem(key(name)); } catch (e) { } }
  function bind(form, name, debounce) {
    if (!form) return;
    const n = name || (form.id || "form");
    const d = debounce || 400;
    let t;
    const collect = () => {
      const out = {};
      form.querySelectorAll("input,select,textarea").forEach(el => {
        if (!el.name && !el.id) return;
        const k = el.name || el.id;
        if (el.type === "checkbox" || el.type === "radio") out[k] = el.checked;
        else out[k] = el.value;
      });
      return out;
    };
    const apply = (data) => {
      if (!data) return;
      Object.entries(data).forEach(([k, v]) => {
        const el = form.querySelector(`[name="${k}"], #${k}`);
        if (!el) return;
        if (el.type === "checkbox" || el.type === "radio") el.checked = !!v;
        else el.value = v;
      });
    };
    apply(load(n));
    form.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => save(n, collect()), d);
    });
  }
  window.Autosave = { save, load, clear, bind };
})();
