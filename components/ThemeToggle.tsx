"use client";
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { applyTheme, currentTheme, keepBarsInStep, setTheme, watchTheme, type Theme } from "@/lib/theme";
import styles from "./Masthead.module.css";

const onServer = (): Theme => "light";

/** The half-moon in the masthead: tap to turn the lights down, or back up. */
export function ThemeToggle() {
  const theme = useSyncExternalStore(watchTheme, currentTheme, onServer);
  const [turns, setTurns] = useState(0);

  // Keeps the page in step when the phone's setting or another tab changes the theme.
  useLayoutEffect(applyTheme, [theme]);
  useEffect(keepBarsInStep, []);

  function toggle() {
    const change = () => setTheme(theme === "dark" ? "light" : "dark");
    setTurns((t) => t + 1);
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Where the browser can, the two themes cross-fade instead of snapping.
    if (document.startViewTransition && !still) document.startViewTransition(change);
    else change();
  }

  const label = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  return (
    <button className={styles.theme} onClick={toggle} aria-label={label} title={label}>
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden style={{ transform: `rotate(${turns * 180}deg)` }}>
        <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <path d="M8 1.75a6.25 6.25 0 0 1 0 12.5z" fill="currentColor" />
      </svg>
    </button>
  );
}
