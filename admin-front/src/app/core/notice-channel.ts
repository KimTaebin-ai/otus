export type NoticeChannel = 'service' | 'email' | 'both';

export const NOTICE_CHANNELS: { value: NoticeChannel; label: string }[] = [
  { value: 'service', label: '앱 내부 알림' },
  { value: 'email', label: '이메일' },
  { value: 'both', label: '앱 내부 알림 · 이메일' },
];

export function noticeChannelLabel(channel: NoticeChannel): string {
  return NOTICE_CHANNELS.find((option) => option.value === channel)!.label;
}
