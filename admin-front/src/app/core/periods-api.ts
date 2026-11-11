import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

export interface SubmissionPeriod {
  target_month: string;
  opens_at: string | null;
  closes_at: string | null;
  version: number | null;
  state: 'not_set' | 'upcoming' | 'open' | 'closed';
}

export interface PeriodList {
  current_month: string;
  year: number;
  can_manage: boolean;
  items: SubmissionPeriod[];
}

export interface PeriodSave {
  opens_at: string;
  closes_at: string;
  expected_version: number | null;
}

export interface PeriodChange extends Omit<PeriodSave, 'expected_version'> {
  version: number;
  actor_name: string;
  actor_role: 'operator' | 'admin';
  previous_opens_at: string | null;
  previous_closes_at: string | null;
  created_at: string;
}

export const PERIOD_LABELS: Record<SubmissionPeriod['state'], string> = {
  not_set: '미설정',
  upcoming: '접수 예정',
  open: '접수 중',
  closed: '마감',
};

const KST_MS = 9 * 60 * 60 * 1000;
/** datetime-local displays KST wall time even when the browser uses another timezone. */
export function periodInput(iso: string, subtractMs = 0): string {
  return new Date(Date.parse(iso) + KST_MS - subtractMs).toISOString().slice(0, 19);
}

export function periodDefaults(month: string): { start: string; end: string } {
  const [year, number] = month.split('-').map(Number);
  const next =
    number === 12
      ? `${String(year + 1).padStart(4, '0')}-01`
      : `${String(year).padStart(4, '0')}-${String(number + 1).padStart(2, '0')}`;
  return { start: `${month}-01T00:00:00`, end: periodInput(`${next}-01T00:00:00+09:00`, 1000) };
}

export function periodSave(
  month: string,
  start: string,
  end: string,
  version: number | null,
): PeriodSave | null {
  const parse = (value: string): number | null => {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return null;
    const normalized = value.length === 16 ? value + ':00' : value;
    const iso = normalized + '+09:00';
    const time = Date.parse(iso);
    return Number.isFinite(time) && periodInput(iso) === normalized ? time : null;
  };
  const from = parse(start);
  const through = parse(end);
  const bounds = periodDefaults(month);
  if (
    from === null ||
    through === null ||
    from > through ||
    from < Date.parse(bounds.start + '+09:00') ||
    through > Date.parse(bounds.end + '+09:00')
  )
    return null;
  return {
    opens_at: new Date(from).toISOString(),
    closes_at: new Date(through + 1000).toISOString(),
    expected_version: version,
  };
}

@Injectable({ providedIn: 'root' })
export class PeriodsApi {
  private readonly http = inject(HttpClient);

  list(year?: number) {
    const params = year === undefined ? new HttpParams() : new HttpParams().set('year', year);
    return this.http.get<PeriodList>('/api/admin/cycles', { params });
  }

  save(month: string, body: PeriodSave) {
    return this.http.put<SubmissionPeriod>(`/api/admin/cycles/${encodeURIComponent(month)}`, body);
  }

  history(month: string) {
    return this.http.get<PeriodChange[]>(`/api/admin/cycles/${encodeURIComponent(month)}/history`);
  }
}
