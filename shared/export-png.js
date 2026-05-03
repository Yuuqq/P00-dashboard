(function () {
  "use strict";
  function downloadDataURL(dataUrl, filename) {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename || ("export-" + Date.now() + ".png");
    document.body.appendChild(a); a.click(); a.remove();
  }
  function fromCanvas(canvas, filename) {
    if (!canvas) return false;
    try { downloadDataURL(canvas.toDataURL("image/png"), filename); return true; }
    catch (e) { console.error("export-png canvas:", e); return false; }
  }
  async function fromElement(el, filename) {
    if (!el) return false;
    if (typeof window.html2canvas === "function") {
      try {
        const canvas = await window.html2canvas(el, { backgroundColor: null, scale: window.devicePixelRatio || 1 });
        return fromCanvas(canvas, filename);
      } catch (e) { console.error("export-png html2canvas:", e); return false; }
    }
    // Fallback: SVG foreignObject — limited browser support
    try {
      const r = el.getBoundingClientRect();
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${r.width}" height="${r.height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml">${el.outerHTML}</div></foreignObject></svg>`;
      const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
      const canvas = document.createElement("canvas");
      canvas.width = r.width; canvas.height = r.height;
      canvas.getContext("2d").drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      return fromCanvas(canvas, filename);
    } catch (e) { console.error("export-png svg fallback:", e); return false; }
  }
  window.ExportPNG = { fromCanvas, fromElement, downloadDataURL };
})();
