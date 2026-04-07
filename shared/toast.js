/**
 * 🔔 全局 Toast 通知系统
 * 本文件为 P00-dashboard 的本地副本，用于保持仓库自包含。
 * 若上游 shared 版本更新，需要按需同步这里的实现。
 * 引入方式: <script src="./shared/toast.js" defer></script>
 *
 * API:
 *   window.showToast("消息内容", "success"|"info"|"warn"|"error", 3000, { track?: boolean })
 *   window.clearToasts()
 *   window.replaceToasts("消息内容", "success"|"info"|"warn"|"error", 3000, { track?: boolean })
 *   window.showFreshToast("消息内容", "success"|"info"|"warn"|"error", 3000, { track?: boolean })
 *
 * 自动堆叠，自动消失，支持手动关闭。
 */
(function () {
  let container = null;

  function ensureContainer() {
    if (container) return container;
    container = document.createElement("div");
    container.id = "toastContainer";
    container.setAttribute("role", "region");
    container.setAttribute("aria-label", "页面消息");
    container.setAttribute("aria-live", "polite");
    container.setAttribute("aria-relevant", "additions");
    container.style.cssText = [
      "position:fixed", "top:56px", "right:16px", "z-index:99998",
      "display:flex", "flex-direction:column", "gap:8px",
      "pointer-events:none", "max-width:360px"
    ].join(";");
    document.body.appendChild(container);
    return container;
  }

  const ICONS = { success: "✅", info: "ℹ️", warn: "⚠️", error: "❌" };
  const COLORS = {
    success: { bg: "var(--ok-light,#e8f5ee)", border: "var(--ok,#0b7a3b)" },
    info: { bg: "var(--accent-light,rgba(199,73,31,0.08))", border: "var(--accent,#c7491f)" },
    warn: { bg: "var(--warn-light,#fef7e0)", border: "var(--warn,#b86e00)" },
    error: { bg: "var(--bad-light,#fdecea)", border: "var(--bad,#a61f12)" }
  };

  window.showToast = function (message, type, duration, options) {
    type = type || "info";
    duration = duration ?? 3000;
    const safeMessage = message == null ? "" : String(message);
    const settings = options && typeof options === "object" ? options : {};
    const c = COLORS[type] || COLORS.info;

    ensureContainer();

    const toast = document.createElement("div");
    const isAssertive = type === "error" || type === "warn";
    toast.setAttribute("role", isAssertive ? "alert" : "status");
    toast.setAttribute("aria-live", isAssertive ? "assertive" : "polite");
    toast.setAttribute("aria-atomic", "true");
    toast.dataset.toastType = type;
    toast.dataset.toastMessage = safeMessage;
    toast.dataset.toastTrack = settings.track === false ? "off" : "on";
    toast.style.cssText = [
      `background:${c.bg}`, `border-left:4px solid ${c.border}`,
      "padding:10px 14px", "border-radius:8px", "font-size:13px",
      "color:var(--ink,#1a1a1a)", "box-shadow:0 4px 12px rgba(0,0,0,0.12)",
      "display:flex", "align-items:center", "gap:8px",
      "pointer-events:auto", "cursor:pointer",
      "animation:toastSlideIn .25s ease-out",
      "font-family:var(--font-sans,system-ui)"
    ].join(";");

    const icon = document.createElement("span");
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = ICONS[type] || "";

    const body = document.createElement("span");
    body.style.flex = "1";
    body.textContent = safeMessage;

    const close = document.createElement("span");
    close.setAttribute("aria-hidden", "true");
    close.style.opacity = "0.4";
    close.style.fontSize = "11px";
    close.textContent = "✕";

    toast.append(icon, body, close);
    toast.addEventListener("click", () => removeToast(toast));

    container.appendChild(toast);

    if (duration > 0) {
      setTimeout(() => removeToast(toast), duration);
    }
  };

  function removeToast(el) {
    if (!el || !el.parentNode) return;
    el.style.animation = "toastSlideOut .2s ease-in forwards";
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 200);
  }

  window.clearToasts = function () {
    if (!container) return;
    container.replaceChildren();
    window.pmMetrics?.reconcileStorageState?.({ resetPendingStatus: true });
  };

  window.replaceToasts = function (message, type, duration, options) {
    window.clearToasts?.();
    window.pmMetrics?.reconcileStorageState?.({ resetPendingStatus: true, suppressActiveStatus: true });
    window.showToast?.(message, type, duration, options);
  };

  window.showFreshToast = function (message, type, duration, options) {
    if (typeof window.replaceToasts === "function") {
      window.replaceToasts(message, type, duration, options);
      return;
    }
    window.clearToasts?.();
    window.pmMetrics?.reconcileStorageState?.({ resetPendingStatus: true, suppressActiveStatus: true });
    window.showToast?.(message, type, duration, options);
  };

  // Inject animation keyframes
  const style = document.createElement("style");
  style.textContent = `
    @keyframes toastSlideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
    @keyframes toastSlideOut { from { transform: translateX(0); opacity: 1; } to { transform: translateX(100%); opacity: 0; } }
  `;
  document.head.appendChild(style);
})();
