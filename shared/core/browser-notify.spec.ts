import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  askOnFirstVisit,
  browserNotifyState,
  newItems,
  showBrowserNotice,
  showBrowserNotices,
} from './browser-notify';

function stubNotification(permission: NotificationPermission) {
  const shown: { title: string; options?: NotificationOptions }[] = [];
  vi.stubGlobal(
    'Notification',
    class {
      static permission = permission;
      static requestPermission = vi.fn(async () => permission);
      onclick: (() => void) | null = null;
      constructor(title: string, options?: NotificationOptions) {
        shown.push({ title, options });
      }
      close() {}
    },
  );
  return shown;
}

afterEach(() => vi.unstubAllGlobals());

describe('browser notifications', () => {
  it('does nothing where the API is missing or the user has not allowed it', () => {
    vi.stubGlobal('Notification', undefined);
    expect(browserNotifyState()).toBe('unsupported');
    expect(showBrowserNotice({ title: 'a', tag: 't' })).toBe(false);
    for (const permission of ['default', 'denied'] as const) {
      const shown = stubNotification(permission);
      expect(showBrowserNotice({ title: 'a', tag: 't' })).toBe(false);
      expect(shown).toHaveLength(0);
    }
  });

  it('shows a notification once permission is granted', () => {
    const shown = stubNotification('granted');
    expect(
      showBrowserNotice({ title: '서류 보완이 필요해요', body: '확인해 주세요', tag: 'n1' }),
    ).toBe(true);
    expect(shown[0].title).toBe('서류 보완이 필요해요');
    expect(shown[0].options?.tag).toBe('n1');
  });

  it('turns a burst into a few notifications and one summary', () => {
    const shown = stubNotification('granted');
    const notices = [1, 2, 3, 4, 5].map((n) => ({ title: `알림 ${n}`, tag: `n${n}` }));
    showBrowserNotices(notices, 'summary');
    expect(shown.map((s) => s.title)).toEqual([
      '알림 1',
      '알림 2',
      '알림 3',
      '새 알림 2건이 더 있어요',
    ]);
  });

  it('does not replay history on the first look, then reports only what is new', () => {
    const first = newItems(null, [{ id: 'a' }, { id: 'b' }], (i) => i.id);
    expect(first.fresh).toEqual([]);
    const next = newItems(first.ids, [{ id: 'c' }, { id: 'a' }, { id: 'b' }], (i) => i.id);
    expect(next.fresh).toEqual([{ id: 'c' }]);
  });
});

describe('askOnFirstVisit', () => {
  beforeEach(() => localStorage.removeItem('otus-browser-notify-asked'));

  it('asks right away, once per browser', async () => {
    stubNotification('granted');
    // the stub's permission is already decided: nothing to ask
    const decided = vi.fn();
    askOnFirstVisit(decided);
    expect(decided).not.toHaveBeenCalled();

    const request = vi.fn(async () => 'granted' as NotificationPermission);
    vi.stubGlobal(
      'Notification',
      Object.assign(class {}, { permission: 'default', requestPermission: request }),
    );
    const seen = vi.fn();
    askOnFirstVisit(seen);
    await vi.waitFor(() => expect(seen).toHaveBeenCalledWith('granted'));
    expect(request).toHaveBeenCalledTimes(1);

    // a second visit (permission still "default", e.g. dismissed) does not ask again
    askOnFirstVisit(seen);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('where the request needs a click (answers "default" at once), asks on the first interaction', async () => {
    const request = vi.fn(async () => 'default' as NotificationPermission);
    vi.stubGlobal(
      'Notification',
      Object.assign(class {}, { permission: 'default', requestPermission: request }),
    );
    askOnFirstVisit(() => {});
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    document.dispatchEvent(new Event('pointerdown'));
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  });
});
