import path from "node:path";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function getLocalAssetPath(ref) {
  if (typeof ref !== "string" || !ref.startsWith("./")) return "";
  return path.resolve(ROOT_DIR, ref.slice(2));
}

async function assertLocalAssetExists(ref, label) {
  const assetPath = getLocalAssetPath(ref);
  assert(assetPath.startsWith(ROOT_DIR), `${label} escapes the project root: ${ref}`);
  await access(assetPath);
}

function extractHtmlAssetRefs(source) {
  return [...source.matchAll(/\b(?:href|src)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((value) => value.startsWith("./"));
}

function extractFirstMatch(source, pattern, label) {
  const match = source.match(pattern);
  assert(!!match && typeof match[1] === "string" && match[1].length > 0, `Could not extract ${label} from index.html`);
  return match[1];
}

function extractTagAssetRefs(source, tagName, attrName) {
  const pattern = new RegExp(`<${tagName}\\b[^>]*\\b${attrName}="([^"]+)"[^>]*>`, "gi");
  return [...source.matchAll(pattern)]
    .map((match) => match[1])
    .filter((value) => value.startsWith("./"));
}

function extractSection(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  assert(start !== -1, `Could not locate ${label} start marker`);
  const end = source.indexOf(endMarker, start);
  assert(end !== -1, `Could not locate ${label} end marker`);
  return source.slice(start, end);
}

function extractCssVar(block, variableName, label) {
  const pattern = new RegExp(`${variableName}\\s*:\\s*([^;]+);`);
  const match = block.match(pattern);
  assert(!!match && typeof match[1] === "string" && match[1].trim().length > 0, `Could not extract ${variableName} from ${label}`);
  return match[1].trim();
}

function extractQuotedArrayConstant(source, constantName) {
  const pattern = new RegExp(`const\\s+${constantName}\\s*=\\s*\\[([\\s\\S]*?)\\];`);
  const match = source.match(pattern);
  assert(!!match && !!match[1], `Could not locate array constant ${constantName}`);
  const values = [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
  assert(values.length > 0, `Array constant ${constantName} did not contain any quoted entries`);
  return values;
}

const manifest = JSON.parse(await readFile(path.join(ROOT_DIR, "manifest.json"), "utf8"));
const indexSource = await readFile(path.join(ROOT_DIR, "index.html"), "utf8");
const serviceWorkerSource = await readFile(path.join(ROOT_DIR, "sw.js"), "utf8");
const appSource = await readFile(path.join(ROOT_DIR, "app.js"), "utf8");
const designTokensSource = await readFile(path.join(ROOT_DIR, "shared", "design-tokens.css"), "utf8");
const darkToggleSource = await readFile(path.join(ROOT_DIR, "shared", "dark-toggle.js"), "utf8");
const toastSource = await readFile(path.join(ROOT_DIR, "shared", "toast.js"), "utf8");
const coreAssets = extractQuotedArrayConstant(serviceWorkerSource, "CORE_ASSETS");
const expectedCoreAssets = [...new Set([
  ...extractHtmlAssetRefs(indexSource),
  ...(typeof manifest.start_url === "string" && manifest.start_url.startsWith("./") ? [manifest.start_url] : []),
  ...((manifest.icons || []).map((icon) => icon?.src).filter((value) => typeof value === "string" && value.startsWith("./")))
])];
const modulesSection = extractSection(appSource, "const MODULES = [", "const VALID_TOOL_IDS =", "MODULES section");
const missionsSection = extractSection(appSource, "const MISSIONS = [", "const MISSION_STEP_COUNTS =", "MISSIONS section");
const toolSlugsSection = extractSection(appSource, "const TOOL_SLUGS = {", "function getToolSlug", "TOOL_SLUGS section");
const lightThemeBlock = extractSection(designTokensSource, ":root {", "/* ===== Dark Mode", "light design tokens");
const manualDarkThemeBlock = extractSection(designTokensSource, ":root[data-theme=\"dark\"] {", "/* ===== Global Reset =====", "manual dark design tokens");
const htmlLang = extractFirstMatch(indexSource, /<html[^>]*\blang="([^"]+)"/i, "html lang");
const htmlTitle = extractFirstMatch(indexSource, /<title>([^<]+)<\/title>/i, "document title");
const appleTitle = extractFirstMatch(indexSource, /<meta\s+name="apple-mobile-web-app-title"\s+content="([^"]+)"/i, "apple mobile web app title");
const themeColorMetas = [...indexSource.matchAll(/<meta\s+name="theme-color"\s+content="([^"]+)"(?:\s+media="([^"]+)")?[^>]*>/gi)]
  .map((match) => ({ content: match[1] || "", media: match[2] || "" }));
const lightThemeBg = extractCssVar(lightThemeBlock, "--bg", "light design tokens");
const lightThemeAccent = extractCssVar(lightThemeBlock, "--accent", "light design tokens");
const darkThemeBg = extractCssVar(manualDarkThemeBlock, "--bg", "manual dark design tokens");
const darkToggleFallbackDark = extractFirstMatch(darkToggleSource, /theme\s*===\s*"dark"\s*\?\s*"([^"]+)"\s*:\s*"([^"]+)"/, "dark-toggle fallback dark color");
const darkToggleFallbackLight = (() => {
  const match = darkToggleSource.match(/theme\s*===\s*"dark"\s*\?\s*"([^"]+)"\s*:\s*"([^"]+)"/);
  assert(!!match && typeof match[2] === "string" && match[2].length > 0, "Could not extract dark-toggle fallback light color");
  return match[2];
})();
const stylesheetRefs = extractTagAssetRefs(indexSource, "link", "href");
const scriptRefs = extractTagAssetRefs(indexSource, "script", "src");
const moduleIds = [...modulesSection.matchAll(/\bid:\s*"([^"]+)"/g)].map((match) => match[1]).filter((value) => value.startsWith("mod-"));
const toolIds = [...modulesSection.matchAll(/\bid:\s*"([^"]+)"/g)].map((match) => match[1]).filter((value) => /^P\d+$/.test(value));
const missionIds = [...missionsSection.matchAll(/\bid:\s*"([^"]+)"/g)].map((match) => match[1]).filter((value) => value.startsWith("mission-"));
const missionToolIds = [...missionsSection.matchAll(/\btool:\s*"([^"]+)"/g)].map((match) => match[1]);
const toolSlugIds = [...toolSlugsSection.matchAll(/\b(P\d+)\s*:/g)].map((match) => match[1]);
const duplicateToolIds = toolIds.filter((id, index, ids) => ids.indexOf(id) !== index).filter((id, index, ids) => ids.indexOf(id) === index);
const missingSlugIds = [...new Set(toolIds)].filter((id) => !toolSlugIds.includes(id));
const unknownMissionToolIds = [...new Set(missionToolIds.filter((id) => !toolIds.includes(id)))];
const extraSlugIds = [...new Set(toolSlugIds.filter((id) => !toolIds.includes(id)))];
const htmlIds = [...indexSource.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const appRequiredIds = [...new Set([...appSource.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]))];
const tabNav = (() => {
  const match = indexSource.match(/<nav[^>]*id="tabNav"[^>]*role="([^"]+)"[^>]*aria-label="([^"]+)"/);
  assert(!!match, "Could not extract tab navigation semantics from index.html");
  return { role: match[1], ariaLabel: match[2] };
})();
const tabs = [...indexSource.matchAll(/<button[^>]*class="([^"]*tab[^"]*)"[^>]*id="([^"]+)"[^>]*data-tab="([^"]+)"[^>]*role="([^"]+)"[^>]*aria-selected="([^"]+)"[^>]*aria-controls="([^"]+)"[^>]*tabindex="([^"]+)"/g)]
  .map((match) => ({ classes: match[1], id: match[2], dataTab: match[3], role: match[4], ariaSelected: match[5], controls: match[6], tabIndex: match[7] }));
const tabPanels = [...indexSource.matchAll(/<section[^>]*class="([^"]*tab-panel[^"]*)"[^>]*id="([^"]+)"[^>]*role="([^"]+)"[^>]*aria-labelledby="([^"]+)"([^>]*)>/g)]
  .map((match) => ({ classes: match[1], id: match[2], role: match[3], labelledBy: match[4], attrs: match[5] || "" }));
const modalAria = (() => {
  const match = indexSource.match(/role="dialog"[^>]*aria-labelledby="([^"]+)"[^>]*aria-describedby="([^"]+)"/);
  assert(!!match, "Could not extract modal aria wiring from index.html");
  return { labelledBy: match[1], describedBy: match[2] };
})();

assert(typeof manifest.id === "string" && manifest.id.startsWith("./"), `manifest id must stay relative: ${JSON.stringify(manifest.id)}`);
assert(typeof manifest.start_url === "string" && manifest.start_url.startsWith("./"), `manifest start_url must stay relative: ${JSON.stringify(manifest.start_url)}`);
assert(typeof manifest.scope === "string" && manifest.scope.startsWith("./"), `manifest scope must stay relative: ${JSON.stringify(manifest.scope)}`);
assert(Array.isArray(manifest.icons) && manifest.icons.length > 0, "manifest icons must contain at least one entry");
assert(coreAssets.filter((ref, index, refs) => refs.indexOf(ref) !== index).length === 0, `sw.js CORE_ASSETS contains duplicate entries: ${JSON.stringify(coreAssets)}`);
assert(expectedCoreAssets.filter((ref) => !coreAssets.includes(ref)).length === 0, `sw.js CORE_ASSETS is missing index/manifest assets: ${JSON.stringify(expectedCoreAssets.filter((ref) => !coreAssets.includes(ref)))}`);
assert(htmlLang === manifest.lang, `index.html lang should stay aligned with manifest lang: ${JSON.stringify({ htmlLang, manifestLang: manifest.lang })}`);
assert(htmlTitle === manifest.name, `index.html title should stay aligned with manifest name: ${JSON.stringify({ htmlTitle, manifestName: manifest.name })}`);
assert(appleTitle === manifest.short_name, `apple mobile web app title should stay aligned with manifest short_name: ${JSON.stringify({ appleTitle, manifestShortName: manifest.short_name })}`);
assert(themeColorMetas.length === 2, `index.html should expose exactly two source theme-color metas for light/dark startup chrome: ${JSON.stringify(themeColorMetas)}`);
assert(themeColorMetas.some((meta) => meta.media === "(prefers-color-scheme: light)" && meta.content === lightThemeBg), `index.html light theme-color meta should match the light --bg token: ${JSON.stringify({ themeColorMetas, lightThemeBg })}`);
assert(themeColorMetas.some((meta) => meta.media === "(prefers-color-scheme: dark)" && meta.content === darkThemeBg), `index.html dark theme-color meta should match the dark --bg token: ${JSON.stringify({ themeColorMetas, darkThemeBg })}`);
assert(manifest.background_color === lightThemeBg, `manifest background_color should match the light --bg token: ${JSON.stringify({ manifestBackground: manifest.background_color, lightThemeBg })}`);
assert(manifest.theme_color === lightThemeAccent, `manifest theme_color should match the light --accent token: ${JSON.stringify({ manifestThemeColor: manifest.theme_color, lightThemeAccent })}`);
assert(darkToggleFallbackDark === darkThemeBg, `dark-toggle fallback dark theme-color should match the dark --bg token: ${JSON.stringify({ darkToggleFallbackDark, darkThemeBg })}`);
assert(darkToggleFallbackLight === lightThemeBg, `dark-toggle fallback light theme-color should match the light --bg token: ${JSON.stringify({ darkToggleFallbackLight, lightThemeBg })}`);
assert(stylesheetRefs.indexOf("./shared/design-tokens.css") !== -1 && stylesheetRefs.indexOf("./styles.css") !== -1, `index.html is missing required stylesheets: ${JSON.stringify(stylesheetRefs)}`);
assert(stylesheetRefs.indexOf("./shared/design-tokens.css") < stylesheetRefs.indexOf("./styles.css"), `index.html should load design tokens before app styles: ${JSON.stringify(stylesheetRefs)}`);
assert(scriptRefs.join("|") === "./pm-metrics.js|./shared/toast.js|./app.js|./shared/dark-toggle.js", `index.html script order drifted from the expected shared/runtime contract: ${JSON.stringify(scriptRefs)}`);
assert(toastSource.includes("window.showToast = function"), "shared/toast.js must expose window.showToast");
assert(toastSource.includes("window.clearToasts = function"), "shared/toast.js must expose window.clearToasts");
assert(toastSource.includes("window.replaceToasts = function"), "shared/toast.js must expose window.replaceToasts");
assert(toastSource.includes("window.showFreshToast = function"), "shared/toast.js must expose window.showFreshToast");
assert(appSource.includes("const showFreshToast = (message, type, duration, options) => {"), "app.js must define the local showFreshToast adapter");
assert(appSource.includes('typeof window.showFreshToast === "function"'), "app.js should delegate showFreshToast calls to the shared helper when available");
assert(darkToggleSource.includes('typeof window.showFreshToast === "function"'), "shared/dark-toggle.js should prefer the shared showFreshToast helper when available");
assert(darkToggleSource.includes('const THEME_QUERY = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;'), "shared/dark-toggle.js should tolerate browsers without window.matchMedia by falling back to a null theme query");
assert(darkToggleSource.includes("function safeGetTheme() {"), "shared/dark-toggle.js should keep a guarded storage read helper for theme preference access");
assert(darkToggleSource.includes("} catch (_e) {\n      return null;"), "shared/dark-toggle.js should treat unreadable stored theme values as missing by returning null from safeGetTheme()");
assert(darkToggleSource.includes('return THEME_QUERY && THEME_QUERY.matches ? "dark" : "light";'), "shared/dark-toggle.js should fall back to light mode when no prefers-color-scheme query is available");
assert(darkToggleSource.includes("return getStoredTheme() || getSystemTheme();"), "shared/dark-toggle.js should resolve the preferred theme from stored preference first, then system theme");
assert(darkToggleSource.includes("function syncToggleButton(btn, theme) {"), "shared/dark-toggle.js should keep a dedicated helper for syncing the dark-toggle button state");
assert(darkToggleSource.includes("syncToggleButton(btn, theme);"), "shared/dark-toggle.js should keep the runtime applyTheme() path wired to sync the toggle button state");
assert(darkToggleSource.includes('syncToggleButton(btn, document.documentElement.getAttribute("data-theme") || getPreferred());'), "shared/dark-toggle.js should initialize the created dark-toggle button from the current preferred theme");
assert(darkToggleSource.includes('return stored === "dark" || stored === "light" ? stored : null;'), "shared/dark-toggle.js should ignore invalid stored theme values instead of treating them as pinned themes");
assert(darkToggleSource.includes("if (!getStoredTheme()) applyTheme(getSystemTheme());"), "shared/dark-toggle.js should ignore later system-theme changes once a stored theme preference exists");
assert(darkToggleSource.includes('THEME_QUERY.addEventListener("change", handleSystemThemeChange)'), "shared/dark-toggle.js should register prefers-color-scheme changes through matchMedia.addEventListener when available");
assert(darkToggleSource.includes('THEME_QUERY.addListener(handleSystemThemeChange)'), "shared/dark-toggle.js should keep the legacy matchMedia.addListener fallback for older browsers");
assert(darkToggleSource.includes('if (event.key !== null && event.key !== STORAGE_KEY) return;'), "shared/dark-toggle.js should ignore unrelated storage events and only react to theme-key or clear-all updates");
assert(darkToggleSource.includes("applyTheme(getPreferred());"), "shared/dark-toggle.js should apply the resolved preferred theme during startup");
assert(duplicateToolIds.length === 0, `Catalog contains duplicate tool ids: ${JSON.stringify(duplicateToolIds)}`);
assert(missingSlugIds.length === 0, `Catalog contains tool ids without slugs: ${JSON.stringify(missingSlugIds)}`);
assert(unknownMissionToolIds.length === 0, `Mission catalog references unknown tool ids: ${JSON.stringify(unknownMissionToolIds)}`);
assert(extraSlugIds.length === 0, `Tool slug map contains entries not present in the catalog: ${JSON.stringify(extraSlugIds)}`);
assert(indexSource.includes(`content="新闻素养学习中枢 — ${moduleIds.length} 大模块 · ${toolIds.length} 个工具 · 案例任务链驱动的实战训练"`), "index.html meta description drifted from catalog counts");
assert(indexSource.includes(`>${moduleIds.length} 大模块 · ${toolIds.length} 个工具 · 案例驱动的实战训练<`), "index.html hero subtitle drifted from catalog counts");
assert(indexSource.includes(`/${moduleIds.length} 模块`), "index.html module stat placeholder drifted from catalog counts");
assert(indexSource.includes(`/${missionIds.length} 任务`), "index.html mission stat placeholder drifted from catalog counts");
assert(indexSource.includes(`/${toolIds.length} 涉及工具`), "index.html tool stat placeholder drifted from catalog counts");
assert(indexSource.includes(`${toolIds.length} 个工具按新闻素养核心能力分为 ${moduleIds.length} 大模块。`), "index.html modules description drifted from catalog counts");
assert(indexSource.includes(`新闻素养工具集 · ${toolIds.length} 个项目 · `), "index.html footer catalog text drifted from catalog counts");
assert(manifest.description === `新闻素养学习中枢 — ${moduleIds.length} 大模块、${toolIds.length} 个工具、案例驱动的实战训练入口。`, `manifest description drifted from catalog counts: ${JSON.stringify(manifest.description)}`);
assert(appRequiredIds.filter((id) => !htmlIds.includes(id)).length === 0, `index.html is missing DOM ids required by app.js: ${JSON.stringify(appRequiredIds.filter((id) => !htmlIds.includes(id)))}`);
assert(tabNav.role === "tablist", `Tab navigation role drifted from the expected tablist semantics: ${JSON.stringify(tabNav)}`);
assert(tabNav.ariaLabel === "学习中枢主导航", `Tab navigation aria-label drifted from the expected label: ${JSON.stringify(tabNav)}`);
assert(tabs.length === tabPanels.length && tabs.length > 0, `index.html tab/panel counts drifted: ${JSON.stringify({ tabs, tabPanels })}`);
tabs.forEach((tab) => {
  assert(htmlIds.includes(tab.controls), `Tab aria-controls target is missing: ${JSON.stringify(tab)}`);
  const panel = tabPanels.find((entry) => entry.id === tab.controls);
  assert(!!panel, `Tab aria-controls does not point to a known panel: ${JSON.stringify(tab)}`);
  assert(panel.labelledBy === tab.id, `Panel aria-labelledby does not point back to its tab: ${JSON.stringify({ tab, panel })}`);
  assert(tab.controls === `panel${tab.dataTab.charAt(0).toUpperCase()}${tab.dataTab.slice(1)}`, `Tab data-tab no longer matches the panel id pattern used by app.js: ${JSON.stringify(tab)}`);
  assert(tab.role === "tab", `Tab role semantics drifted from the expected role="tab" wiring: ${JSON.stringify(tab)}`);
  const tabIsActive = /\bactive\b/.test(tab.classes);
  assert(tab.ariaSelected === (tabIsActive ? "true" : "false"), `Tab aria-selected no longer matches the startup active class: ${JSON.stringify(tab)}`);
  assert(tab.tabIndex === (tabIsActive ? "0" : "-1"), `Tab tabindex no longer matches the startup active class: ${JSON.stringify(tab)}`);
});
tabPanels.forEach((panel) => {
  assert(htmlIds.includes(panel.labelledBy), `Panel aria-labelledby target is missing: ${JSON.stringify(panel)}`);
  assert(panel.role === "tabpanel", `Panel role semantics drifted from the expected role="tabpanel" wiring: ${JSON.stringify(panel)}`);
  const panelIsActive = /\bactive\b/.test(panel.classes);
  const panelIsHidden = /\bhidden\b/.test(panel.attrs);
  assert(panelIsHidden !== panelIsActive, `Panel hidden attribute should invert the startup active class: ${JSON.stringify(panel)}`);
});
assert(tabs.filter((tab) => /\bactive\b/.test(tab.classes)).length === 1, `index.html should expose exactly one active tab on startup: ${JSON.stringify(tabs)}`);
assert(tabPanels.filter((panel) => /\bactive\b/.test(panel.classes)).length === 1, `index.html should expose exactly one active tab panel on startup: ${JSON.stringify(tabPanels)}`);
assert(tabs.find((tab) => /\bactive\b/.test(tab.classes))?.id === "tabMissions", `Missions tab should be the active startup tab: ${JSON.stringify(tabs)}`);
assert(tabPanels.find((panel) => /\bactive\b/.test(panel.classes))?.id === "panelMissions", `Missions panel should be the active startup panel: ${JSON.stringify(tabPanels)}`);
assert(htmlIds.includes(modalAria.labelledBy), `Modal aria-labelledby target is missing: ${JSON.stringify(modalAria)}`);
assert(htmlIds.includes(modalAria.describedBy), `Modal aria-describedby target is missing: ${JSON.stringify(modalAria)}`);

await assertLocalAssetExists(manifest.start_url, "manifest start_url");

for (const icon of manifest.icons) {
  assert(typeof icon?.src === "string" && icon.src.startsWith("./"), `manifest icon src must stay relative: ${JSON.stringify(icon)}`);
  await assertLocalAssetExists(icon.src, `manifest icon src ${icon.src}`);
}

for (const ref of extractHtmlAssetRefs(indexSource)) {
  await assertLocalAssetExists(ref, `index.html asset ref ${ref}`);
}

for (const ref of coreAssets) {
  if (ref === "./") continue;
  await assertLocalAssetExists(ref, `sw.js CORE_ASSETS ref ${ref}`);
}
