/** What kind of browser Mona is running in. Browser-only: call from effects or handlers. */

/** Built-in browsers of other apps. Chat apps that use Chrome Custom Tabs share Chrome's storage and aren't listed. */
const IN_APP = /\bFBAN|\bFBAV|FB_IAB|Instagram|\bLine\/|Snapchat|musical_ly|Bytedance|TikTok|Pinterest|LinkedInApp|Twitter|; wv\)/i;

export type Platform = { android: boolean; ios: boolean; safari: boolean; inApp: boolean; standalone: boolean };

export function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  return {
    android: /Android/.test(ua),
    ios,
    safari: ios && /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua),
    // On iPhone, other apps' browsers leave "Safari/" out of the user agent;
    // so does Mona added to the Home Screen, which is not an in-app browser.
    inApp: IN_APP.test(ua) || (ios && !/Safari\//.test(ua) && !standalone),
    standalone,
  };
}

/**
 * Share a work through the phone's share sheet, or copy its link where there
 * isn't one. Says which happened; null if it was dismissed or refused.
 */
export async function shareWork(w: { key: string; title: string; artist: string }): Promise<"shared" | "copied" | null> {
  const url = `${location.origin}/${w.key}`;
  const text = `${w.title} — ${w.artist}`;
  try {
    if (navigator.share) {
      await navigator.share({ title: text, text, url });
      return "shared";
    }
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch {
    return null;
  }
}

/** An Android intent link that hands this page to the phone's default browser. */
export function androidBrowserLink() {
  const { host, pathname, search, href, protocol } = window.location;
  return `intent://${host}${pathname}${search}#Intent;scheme=${protocol.replace(":", "")};action=android.intent.action.VIEW;S.browser_fallback_url=${encodeURIComponent(href)};end`;
}
