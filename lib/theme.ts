/**
 * Light or dark. Mona follows the phone's setting until the reader taps the
 * toggle in the masthead. That choice is kept on this device only: it is
 * about this screen, so it isn't synced to an account or put in an export.
 *
 * <html data-theme> always says which theme is showing. A script in <head>
 * sets it before the first paint (app/layout.tsx); ThemeToggle keeps it right
 * afterwards.
 */

export type Theme = "light" | "dark";

export const THEME_KEY = "mona:theme";

/** --paper in each theme (app/globals.css), for the browser's own bars. */
export const PAPER: Record<Theme, string> = { light: "#ffffff", dark: "#15130f" };

const SYSTEM_DARK = "(prefers-color-scheme: dark)";

/** Runs while the page is still being read in, so the wrong theme never shows. */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");if(t!=="light"&&t!=="dark")t=matchMedia("${SYSTEM_DARK}").matches?"dark":"light";document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;

function systemTheme(): Theme {
  return matchMedia(SYSTEM_DARK).matches ? "dark" : "light";
}

/** What the reader chose here, if they chose. */
function savedTheme(): Theme | null {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === "light" || t === "dark" ? t : null;
  } catch {
    return null;
  }
}

export function currentTheme(): Theme {
  return savedTheme() ?? systemTheme();
}

/** Put the current theme on the page and on the browser's bars. */
export function applyTheme() {
  const saved = savedTheme();
  document.documentElement.dataset.theme = saved ?? systemTheme();
  // There is one theme-color tag per system setting; a saved choice overrides both.
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    const colour = PAPER[saved ?? (m.media.includes("dark") ? "dark" : "light")];
    if (m.content !== colour) m.content = colour; // only real changes, or keepBarsInStep would loop
  });
}

/**
 * Moving between pages makes Next write the theme-color tags afresh, which
 * loses a saved choice. Watch <head> and put it back. Returns a function that stops watching.
 */
export function keepBarsInStep() {
  const o = new MutationObserver(applyTheme);
  o.observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ["content"] });
  return () => o.disconnect();
}

const listeners = new Set<() => void>();

/**
 * Choosing what the phone is already set to means "follow the phone" again,
 * so nobody is left stuck in light after their phone goes dark at night.
 */
export function setTheme(next: Theme) {
  try {
    if (next === systemTheme()) localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, next);
  } catch {
    /* storage is off: the choice can't be kept */
  }
  applyTheme();
  listeners.forEach((l) => l());
}

/** Calls back when the theme may have changed: here, in another tab, or on the phone. */
export function watchTheme(l: () => void) {
  const onStorage = (e: StorageEvent) => e.key === THEME_KEY && l();
  const media = matchMedia(SYSTEM_DARK);
  listeners.add(l);
  window.addEventListener("storage", onStorage);
  media.addEventListener("change", l);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
    media.removeEventListener("change", l);
  };
}
