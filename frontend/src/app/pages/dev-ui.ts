import { JsonPipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { switchMap } from 'rxjs';

import {
  CurrentMonthView,
  PreviousMonthView,
  TimeThreshold,
} from '@otus/shared/core/time-requirement';
import { Button } from '@otus/shared/ui/button';
import { Card } from '@otus/shared/ui/card';
import { StatusBadge } from '@otus/shared/ui/status-badge';
import {
  DocType,
  STATUS_LABELS,
  Submission,
  SubmissionFile,
  SubmissionStatus,
} from '../core/api.models';
import { ApiService, errorMessage } from '../core/api.service';
import { UploadSlot } from '../ui/upload-slot';
import { TimeRequirementCard } from './time-requirement-card';

/** Sample values for the 시간 요건 card preview: plain constants, no API (it doesn't exist yet). */
const HOUR = 3600;
const THRESHOLDS: TimeThreshold[] = [
  { seconds: 40 * HOUR, amount: 500000 },
  { seconds: 80 * HOUR, amount: 1000000 },
];
const now = (recognizedSeconds: number): CurrentMonthView => ({
  month: '2026-10',
  asOf: '2026-10-17T14:00:00+09:00',
  recognizedSeconds,
  thresholds: THRESHOLDS,
  decidesAt: '2026-11-01T09:00:00+09:00',
});
const last = (
  recognizedSeconds: number,
  result: PreviousMonthView['result'],
  final: PreviousMonthView['final'] = { status: 'undecided', amount: null },
): PreviousMonthView => ({
  month: '2026-09',
  recognizedSeconds,
  thresholds: THRESHOLDS,
  decidesAt: '2026-10-01T09:00:00+09:00',
  result,
  final,
});
const TIME_SAMPLES: { name: string; current?: CurrentMonthView; previous?: PreviousMonthView }[] = [
  { name: '월중 · 기록 없음 (0시간)', current: now(0) },
  { name: '월중 · 40시간 미만', current: now(23 * HOUR + 10 * 60) },
  { name: '월중 · 40~80시간 달성(예상)', current: now(52 * HOUR + 30 * 60) },
  { name: '월중 · 80시간 이상 달성(예상)', current: now(86 * HOUR) },
  { name: '지난달 · 판정 대기 (1일 00:00~09:00)', previous: last(52 * HOUR, null) },
  {
    name: '지난달 · 미충족',
    previous: last(31 * HOUR + 20 * 60, { status: 'not_met', amount: null }),
  },
  {
    name: '지난달 · 50만 원 구간 충족',
    previous: last(52 * HOUR, { status: 'met', amount: 500000 }),
  },
  {
    name: '지난달 · 100만 원 구간 충족',
    previous: last(91 * HOUR, { status: 'met', amount: 1000000 }),
  },
  { name: '지난달 · 판단 보류', previous: last(0, { status: 'on_hold', amount: null }) },
  {
    name: '지난달 · 수령 대상 확정 (final eligible)',
    previous: last(
      91 * HOUR,
      { status: 'met', amount: 1000000 },
      { status: 'eligible', amount: 1000000 },
    ),
  },
  {
    name: '지난달 · 충족이지만 수령 대상 아님 (final not_eligible)',
    previous: last(
      52 * HOUR,
      { status: 'met', amount: 500000 },
      { status: 'not_eligible', amount: null },
    ),
  },
  {
    name: '조합 · 월중 + 지난달 결과',
    current: now(52 * HOUR + 30 * 60),
    previous: last(31 * HOUR + 20 * 60, { status: 'not_met', amount: null }),
  },
];

/**
 * Dev-only showcase of the shared components (route /dev/ui, registered in dev mode only).
 * Delete once the real screens use every variant.
 */
@Component({
  selector: 'app-dev-ui',
  imports: [Button, Card, StatusBadge, UploadSlot, TimeRequirementCard, JsonPipe],
  template: `
    <h1>공용 컴포넌트</h1>

    <app-card heading="상태 배지">
      <div class="line">
        @for (s of statuses; track s) {
          <app-status-badge [status]="s" />
        }
      </div>
    </app-card>

    <h2>시간 요건 카드 (상수 데이터, API 없음)</h2>
    <div class="grid">
      @for (s of timeSamples; track s.name) {
        <figure>
          <figcaption>{{ s.name }}</figcaption>
          <app-time-requirement-card
            [current]="s.current ?? null"
            [previous]="s.previous ?? null"
          />
        </figure>
      }
    </div>

    <app-card heading="버튼" footnote="제출 버튼은 필수 PDF가 모두 준비되었을 때 활성화됩니다.">
      <div class="line">
        <button appButton variant="secondary" type="button">임시 저장</button>
        <button appButton type="button">제출하기</button>
        <button appButton type="button" disabled>제출 완료</button>
      </div>
    </app-card>

    <app-card heading="업로드 슬롯 (정적)">
      <app-upload-slot mode="kept" label="신분증 / 주민등록초본 / 통장사본" />
      <app-upload-slot docType="id_card" [file]="sampleFile" />
      <app-upload-slot
        docType="bankbook"
        description="지급받을 계좌 · 본인 명의"
        [disabled]="true"
      />
    </app-card>

    <app-card
      heading="업로드 슬롯 (실제 업로드, initial draft)"
      footnote="jpg 등 PDF가 아닌 파일 → 빨간 박스, 백엔드를 끄고 올리면 → 노란 박스"
    >
      @if (draft(); as d) {
        <p class="meta">submission {{ d.id }} · {{ d.target_month }} · {{ d.status }}</p>
        @for (type of d.required_doc_types; track type) {
          <app-upload-slot
            [submissionId]="d.id"
            [docType]="type"
            [file]="fileOf(d, type)"
            (uploaded)="log.set($event)"
          />
        }
      } @else {
        <p class="meta">{{ draftError() ?? 'draft 만드는 중…' }}</p>
      }
    </app-card>

    <app-card heading="API">
      <div class="line">
        <button appButton variant="secondary" type="button" (click)="loadCycle()">
          GET /api/cycles/current
        </button>
        <button appButton variant="secondary" type="button" (click)="loadList()">
          GET /api/submissions
        </button>
        <button appButton type="button" [disabled]="!draft()" (click)="finalize()">finalize</button>
      </div>
      <pre>{{ log() | json }}</pre>
    </app-card>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }
    h1 {
      margin: 0;
      font-size: var(--font-size-page-title);
    }
    h2 {
      margin: 0;
      font-size: var(--font-size-card-title);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
      gap: var(--space-2);
      align-items: start;
    }
    figure {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
      margin: 0;
    }
    figcaption {
      font-size: var(--font-size-caption);
      color: var(--color-muted);
    }
    .line {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-1);
    }
    .meta {
      margin: 0;
      color: var(--color-muted);
    }
    pre {
      margin: 0;
      font-size: var(--font-size-caption);
      white-space: pre-wrap;
    }
  `,
})
export class DevUi {
  private readonly api = inject(ApiService);

  protected readonly timeSamples = TIME_SAMPLES;
  protected readonly statuses = Object.keys(STATUS_LABELS) as SubmissionStatus[];
  protected readonly sampleFile: SubmissionFile = {
    file_id: 'sample',
    doc_type: 'id_card',
    original_name: '신분증_동민.pdf',
    size: 1258291,
    uploaded_at: '2026-10-16T21:12:00+09:00',
  };

  protected readonly draft = signal<Submission | null>(null);
  protected readonly draftError = signal<string | null>(null);
  protected readonly log = signal<unknown>(null);
  /** One key per finalize attempt; reused on retry so it can't submit twice. */
  private finalizeKey = crypto.randomUUID();

  constructor() {
    this.api
      .currentCycle()
      .pipe(
        switchMap((cycle) =>
          this.api.createSubmission({ kind: 'initial', target_month: cycle.target_month }),
        ),
      )
      .subscribe({
        next: (d) => this.draft.set(d),
        error: (err: unknown) => this.draftError.set(errorMessage(err)),
      });
  }

  protected fileOf(d: Submission, type: DocType): SubmissionFile | null {
    return d.files.find((f) => f.doc_type === type) ?? null;
  }

  protected loadCycle(): void {
    this.api.currentCycle().subscribe((c) => this.log.set(c));
  }

  protected loadList(): void {
    this.api.listSubmissions({ include_drafts: true }).subscribe((list) => this.log.set(list));
  }

  protected finalize(): void {
    const d = this.draft();
    if (!d) {
      return;
    }
    this.api.finalize(d.id, this.finalizeKey).subscribe({
      next: (res) => {
        this.log.set(res);
        this.finalizeKey = crypto.randomUUID();
      },
      error: (err: unknown) => this.log.set(errorMessage(err)),
    });
  }
}
