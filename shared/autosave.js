(function () {
  "use strict";
  const PREFIX = "autosave:";
  const SENSITIVE_TYPES = new Set(["password", "hidden"]);
  const SENSITIVE_NAME = /password|secret|token|api[_-]?key|ssn|credit|card|cvv/i;

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

  function isSensitive(el, denylist) {
    if (SENSITIVE_TYPES.has(el.type)) return true;
    const id = (el.name || el.id || "");
    if (SENSITIVE_NAME.test(id)) return true;
    if (denylist && denylist.some(rx => (rx instanceof RegExp ? rx.test(id) : id === rx))) return true;
    if (el.dataset && el.dataset.noautosave != null) return true;
    return false;
  }

  function bind(form, name, optsOrDebounce) {
    if (!form) return;
    const opts = typeof optsOrDebounce === "number" ? { debounce: optsOrDebounce } : (optsOrDebounce || {});
    const debounce = opts.debounce || 400;
    const denylist = opts.denylist || [];
    const n = name || (form.id || "form");

    function fields() { return Array.from(form.querySelectorAll("input,select,textarea")).filter(el => !isSensitive(el, denylist) && (el.name || el.id)); }

    function collect() {
      const out = {};
      const radioSeen = new Set();
      for (const el of fields()) {
        const k = el.name || el.id;
        if (el.type === "radio") {
          if (radioSeen.has(k)) continue;
          radioSeen.add(k);
          const checked = form.querySelector(`input[type="radio"][name="${CSS.escape(k)}"]:checked`);
          out[k] = checked ? checked.value : null;
        } else if (el.type === "checkbox") {
          // Group checkboxes by name → array of checked values; lone checkbox → boolean
          const group = form.querySelectorAll(`input[type="checkbox"][name="${CSS.escape(k)}"]`);
          if (group.length > 1) {
            if (Array.isArray(out[k])) continue;
            out[k] = Array.from(group).filter(c => c.checked).map(c => c.value);
          } else {
            out[k] = el.checked;
          }
        } else {
          out[k] = el.value;
        }
      }
      return out;
    }

    function apply(data) {
      if (!data) return;
      for (const [k, v] of Object.entries(data)) {
        const radios = form.querySelectorAll(`input[type="radio"][name="${CSS.escape(k)}"]`);
        if (radios.length) {
          radios.forEach(r => { r.checked = (r.value === v); });
          continue;
        }
        const checks = form.querySelectorAll(`input[type="checkbox"][name="${CSS.escape(k)}"]`);
        if (checks.length > 1 && Array.isArray(v)) {
          const set = new Set(v);
          checks.forEach(c => { c.checked = set.has(c.value); });
          continue;
        }
        const el = form.querySelector(`[name="${CSS.escape(k)}"], #${CSS.escape(k)}`);
        if (!el) continue;
        if (isSensitive(el, denylist)) continue;
        if (el.type === "checkbox") el.checked = !!v;
        else el.value = v == null ? "" : v;
      }
    }

    apply(load(n));
    let t;
    form.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => save(n, collect()), debounce);
    });
    form.addEventListener("change", () => {
      clearTimeout(t);
      t = setTimeout(() => save(n, collect()), debounce);
    });
  }
  window.Autosave = { save, load, clear, bind };
})();
