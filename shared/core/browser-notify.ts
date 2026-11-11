// OS-level notifications from the browser (the Notification API) for both apps.
//
// The in-app bell stays the source of truth; this only makes a new item visible when the tab
// is in the background. Asking for permission needs a click, so the bells offer a button that
// calls `askBrowserNotifications`. Everything here is safe where the API is missing (old
// browsers, insecure origins, some embedded views): it just does nothing.

export type BrowserNotifyState = 'unsupported' | 'default' | 'granted' | 'denied';

export function browserNotifyState(): BrowserNotifyState {
  if (typeof Notification === 'undefined') {
    return 'unsupported';
  }
  return Notification.permission;
}

/** Call from a click handler: browsers only show the permission prompt after a user gesture. */
export async function askBrowserNotifications(): Promise<BrowserNotifyState> {
  if (typeof Notification === 'undefined') {
    return 'unsupported';
  }
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

const ASKED_KEY = 'otus-browser-notify-asked';

function wasAsked(): boolean {
  try {
    return localStorage.getItem(ASKED_KEY) === '1';
  } catch {
    return false;
  }
}

function markAsked(): void {
  try {
    localStorage.setItem(ASKED_KEY, '1');
  } catch {
    // storage can be blocked: the browser itself stops asking after a refusal
  }
}

/** A request that returns faster than a person could answer was not shown a prompt */
const INSTANT_MS = 300;

/**
 * First visit: ask for permission once, right away. Chrome and Firefox show the prompt without a
 * click. Safari needs one: there the request comes back at once as "default" (no prompt was
 * shown), so the first click or key press asks instead. Asked once per browser, so a dismissal
 * is respected; the bells keep their "브라우저 알림 켜기" button for later. `onChange` gets the
 * answer.
 */
export function askOnFirstVisit(onChange: (state: BrowserNotifyState) => void): void {
  if (browserNotifyState() !== 'default' || wasAsked()) {
    return;
  }
  markAsked();
  const startedAt = Date.now();
  void askBrowserNotifications().then((state) => {
    onChange(state);
    // answered by the user = a real prompt took time; an instant "default" = it needs a gesture
    if (state !== 'default' || Date.now() - startedAt > INSTANT_MS) {
      return;
    }
    const ask = () => {
      document.removeEventListener('pointerdown', ask);
      document.removeEventListener('keydown', ask);
      void askBrowserNotifications().then(onChange);
    };
    document.addEventListener('pointerdown', ask, { once: true });
    document.addEventListener('keydown', ask, { once: true });
  });
}

export interface BrowserNotice {
  title: string;
  body?: string;
  /** Same tag = the browser replaces the earlier one instead of stacking */
  tag: string;
  /** Opened in this tab when the notification is clicked (a path like `/history`) */
  path?: string;
}

/** At most this many separate notifications per update; the rest become one summary. */
export const MAX_SEPARATE = 3;

/** Shows one notification when the user allowed it. Returns whether it was shown. */
export function showBrowserNotice(notice: BrowserNotice): boolean {
  if (browserNotifyState() !== 'granted') {
    return false;
  }
  try {
    const shown = new Notification(notice.title, {
      body: notice.body,
      tag: notice.tag,
      icon: '/favicon.ico',
    });
    shown.onclick = () => {
      window.focus();
      if (notice.path) {
        window.location.assign(notice.path);
      }
      shown.close();
    };
    return true;
  } catch {
    // some browsers only allow notifications from a service worker
    return false;
  }
}

/** New items → notifications: the first few one by one, the rest as "외 n건". */
export function showBrowserNotices(notices: readonly BrowserNotice[], summaryTag: string): void {
  notices.slice(0, MAX_SEPARATE).forEach(showBrowserNotice);
  const rest = notices.length - MAX_SEPARATE;
  if (rest > 0) {
    showBrowserNotice({ title: `새 알림 ${rest}건이 더 있어요`, tag: summaryTag });
  }
}

/**
 * Which items are new since the last look. The first look (`known` is null) only remembers what
 * is there: opening the app must not replay the whole history as notifications.
 */
export function newItems<T>(
  known: ReadonlySet<string> | null,
  items: readonly T[],
  idOf: (item: T) => string,
): { fresh: T[]; ids: Set<string> } {
  const ids = new Set(items.map(idOf));
  const fresh = known === null ? [] : items.filter((item) => !known.has(idOf(item)));
  return { fresh, ids };
}
