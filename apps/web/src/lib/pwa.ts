/**
 * Platform facts the install and push flows both depend on.
 *
 * These two features are entangled on iOS in a way that is easy to miss: Safari
 * only grants web push to a PWA that has been added to the Home Screen. In a
 * normal tab `window.Notification` does not even exist, so a push feature that
 * checks capabilities and quietly renders nothing tells an iPhone user that
 * notifications are impossible, when the real answer is "install the app first".
 * Both flows need the same two answers, so they live in one place.
 */

/** True when the page is running as an installed app rather than a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;

  const matches = (query: string): boolean =>
    typeof window.matchMedia === 'function' && window.matchMedia(query).matches;

  return (
    matches('(display-mode: standalone)') ||
    matches('(display-mode: fullscreen)') ||
    matches('(display-mode: minimal-ui)') ||
    matches('(display-mode: window-controls-overlay)') ||
    // iOS never shipped the display-mode query for home-screen apps; this
    // non-standard flag is the only signal Safari gives.
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    // A TWA launched from the Play Store.
    document.referrer.startsWith('android-app://')
  );
}

/** iOS or iPadOS, including an iPad that reports itself as a Mac. */
export function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) return true;

  // iPadOS 13+ sends a desktop Safari user agent. A Mac with a touchscreen
  // does not exist, so touch points are a reliable tell.
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

/**
 * Whether this browser can install a PWA at all.
 *
 * On iOS, only Safari's own Share sheet can — third-party browsers there are
 * Safari with a different skin and no Add to Home Screen of their own, so
 * pointing a Chrome-on-iOS user at the Share menu would send them somewhere
 * that has no such option.
 */
export function isIosSafari(): boolean {
  if (!isIosDevice()) return false;
  const ua = navigator.userAgent;
  // CriOS = Chrome, FxiOS = Firefox, EdgiOS = Edge, OPT/OPiOS = Opera.
  return !/CriOS|FxiOS|EdgiOS|OPiOS|OPT\//.test(ua);
}
