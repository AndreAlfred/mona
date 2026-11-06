"use client";
/**
 * Everything personal in Mona lives in this browser's storage, so it lasts
 * only as long as the browser keeps it. This asks the browser to keep it,
 * and when it's at risk says so once, with the one tap that fixes it:
 *
 * - Inside another app's built-in browser (Instagram, Facebook, TikTok, an
 *   Android WebView...), storage is often wiped or kept apart from the real
 *   browser. Offer to open Mona in the phone's browser.
 * - In Chrome on Android, offer to add Mona to the Home screen: an installed
 *   Mona keeps its storage like Chrome does, and is more likely to be granted
 *   persistent storage.
 * - In Safari on iPhone, storage is cleared after 7 days without a visit
 *   unless Mona is on the Home Screen; say how to add it.
 *
 * Nothing shows once storage is persistent, in an installed Mona, or before
 * the reader has seen a few works.
 */
import { useEffect, useState } from "react";
import { useDevice } from "@/lib/store";
import styles from "./KeepHistory.module.css";

type Hint = "in-app" | "install" | "ios-home";

const DISMISS_KEY = "mona:hint-dismissed";
const QUIET_DAYS = 14;

/** Built-in browsers of other apps. Chat apps that use Chrome Custom Tabs share Chrome's storage and aren't listed. */
const IN_APP = /\bFBAN|\bFBAV|FB_IAB|Instagram|\bLine\/|Snapchat|musical_ly|Bytedance|TikTok|Pinterest|LinkedInApp|Twitter|; wv\)/i;

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

function dismissedRecently(h: Hint) {
  try {
    const at = JSON.parse(localStorage.getItem(DISMISS_KEY) ?? "{}")[h];
    return typeof at === "number" && Date.now() - at < QUIET_DAYS * 864e5;
  } catch {
    return false;
  }
}

function dismiss(h: Hint) {
  try {
    const all = JSON.parse(localStorage.getItem(DISMISS_KEY) ?? "{}");
    localStorage.setItem(DISMISS_KEY, JSON.stringify({ ...all, [h]: Date.now() }));
  } catch {}
}

/** An Android intent link that hands this page to the phone's default browser. */
function androidBrowserLink() {
  const { host, pathname, search, href, protocol } = window.location;
  return `intent://${host}${pathname}${search}#Intent;scheme=${protocol.replace(":", "")};action=android.intent.action.VIEW;S.browser_fallback_url=${encodeURIComponent(href)};end`;
}

export function KeepHistory() {
  const seen = useDevice((s) => s.history.length);
  const [hint, setHint] = useState<Hint | null>(null);
  const [install, setInstall] = useState<InstallPrompt | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [platform, setPlatform] = useState<{ android: boolean; ios: boolean; safari: boolean; inApp: boolean; standalone: boolean } | null>(null);

  // Ask once per visit for storage the browser won't clear on its own. Chrome
  // decides silently (it grants installed and frequently used sites); it
  // never shows a prompt.
  useEffect(() => {
    const ua = navigator.userAgent;
    const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    setPlatform({
      android: /Android/.test(ua),
      ios,
      safari: ios && /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua),
      inApp: IN_APP.test(ua) || (ios && !/Safari\//.test(ua)),
      standalone: matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true,
    });
    const storage = navigator.storage;
    if (!storage?.persisted) return setPersisted(false);
    storage
      .persisted()
      .then((p) => (p ? true : storage.persist ? storage.persist() : false))
      .then(setPersisted, () => setPersisted(false));
  }, []);

  // Chrome offers installation through this event; keep it for our button.
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallPrompt);
    };
    const onInstalled = () => {
      setInstall(null);
      setHint(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  useEffect(() => {
    if (!platform || persisted === null || platform.standalone) return setHint(null);
    let next: Hint | null = null;
    // In another app's browser, say so straight away: history may not survive this visit.
    if (platform.inApp) next = "in-app";
    else if (!persisted && seen >= 3) {
      if (install) next = "install";
      else if (platform.ios && platform.safari) next = "ios-home";
    }
    setHint(next && !dismissedRecently(next) ? next : null);
  }, [platform, persisted, seen, install]);

  if (!hint || !platform) return null;
  const close = () => {
    dismiss(hint);
    setHint(null);
  };

  return (
    <aside className={styles.bar} role="note" data-hint={hint}>
      {hint === "in-app" && (
        <>
          <p className={styles.text}>
            You’re reading Mona inside another app, whose browser may forget your history.
            {platform.ios && " Tap ··· or the share button and choose Open in Safari to keep it."}
          </p>
          {platform.android && (
            <a className={`${styles.act} smallcaps`} href={androidBrowserLink()}>
              Open in your browser
            </a>
          )}
          {platform.android && <p className={styles.small}>If nothing happens, tap ⋮ and choose Open in browser.</p>}
        </>
      )}
      {hint === "install" && install && (
        <>
          <p className={styles.text}>Add Mona to your Home screen so your history and collection stay on this phone.</p>
          <button
            className={`${styles.act} smallcaps`}
            onClick={async () => {
              await install.prompt();
              const { outcome } = await install.userChoice;
              setInstall(null);
              if (outcome !== "accepted") close();
            }}
          >
            Add to Home screen
          </button>
        </>
      )}
      {hint === "ios-home" && (
        <p className={styles.text}>
          Safari clears Mona’s history after a week away. To keep it, tap the share button and choose Add to Home Screen.
        </p>
      )}
      <button className={`${styles.close} smallcaps`} onClick={close} aria-label="Not now">
        Not now
      </button>
    </aside>
  );
}
