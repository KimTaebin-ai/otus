import { reviewWindow } from '../core/study-hours';
import { countRows } from '../core/window-counts';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { EMPTY, Subscription, distinctUntilChanged, expand, map, reduce } from 'rxjs';
import { AdminMonth } from '../core/admin-month';

import { Button } from '@otus/shared/ui/button';
import { Card } from '@otus/shared/ui/card';
import { Spinner } from '@otus/shared/ui/spinner';
import { StatusBadge } from '@otus/shared/ui/status-badge';
import { DashboardView } from '../core/admin.models';
import {
  AdminSubmissionsApi,
  MonthlyStudentRow,
  MonthlySubmissions,
  submissionMonthLabel,
} from '../core/admin-submissions-api';
import { errorMessage } from '../core/api.service';
import { ActivityService, activityText } from '../core/activity';
import { studentLabel } from '../core/cohort';
import { DataTable } from '../ui/data-table';
import { PageHeader } from '../ui/page-header';
import { DashboardViewComponent } from './dashboard-view';

/** The landing page uses the real monthly list; aggregate-only mock statistics stay in dev preview. */
@Component({
  selector: 'app-dashboard',
  imports: [
    Button,
    Card,
    DashboardViewComponent,
    DataTable,
    PageHeader,
    RouterLink,
    Spinner,
    StatusBadge,
  ],
  template: `
    @if (view(); as v) {
      <app-dashboard-view [view]="v" />
    } @else if (previewing()) {
      <p role="status">미리보기를 불러오는 중…</p>
    } @else {
      <app-page-header
        eyebrow="지원금 운영"
        heading="현황 대시보드"
        description="제출된 서류를 검토하고, 필요한 보완과 제출 안내를 진행하세요."
      />
      <div class="workflows">
        <app-card heading="월별 서류 확인">
          <p>교육생별 최초·월별 제출과 보완 상태를 확인하고 연속 검토를 시작하세요.</p>
          <button appButton variant="secondary" type="button" routerLink="/submissions">
            월별 제출 내역
          </button>
        </app-card>
        <app-card heading="제출 대상 안내">
          <p>아직 제출하지 않은 교육생을 확인하고 제출 안내를 보내세요.</p>
          <button appButton variant="secondary" type="button" routerLink="/notices">
            제출 안내 보내기
          </button>
        </app-card>
        <app-card heading="교육생 정보">
          <p>교육생의 현재 취업 상태와 최초 서류 제출 여부를 확인하세요.</p>
          <button appButton variant="secondary" type="button" routerLink="/users">
            사용자 관리
          </button>
        </app-card>
      </div>
      <div class="summary">
        @if (counts(); as c) {
          <app-card [heading]="window(c.month).studyLabel + ' 학습 지원금 제출 인원'">
            @if (window(c.month); as w) {
              <p class="window">
                <span>{{ w.range }}</span>
              </p>
            }
            <div class="counts">
              <a
                routerLink="/submissions"
                [queryParams]="{ status: 'submitted' }"
                class="submitted"
                aria-label="제출자 월별 제출 내역 보기"
                ><strong>{{ c.submitted }}명</strong><span>제출</span></a
              >
              <a
                routerLink="/submissions"
                [queryParams]="{ status: 'unsubmitted' }"
                class="unsubmitted"
                aria-label="미제출자 월별 제출 내역 보기"
                ><strong>{{ c.unsubmitted }}명</strong><span>미제출</span></a
              >
              <a
                routerLink="/submissions"
                [queryParams]="{ status: 'all' }"
                class="total"
                aria-label="제출 대상자 월별 제출 내역 보기"
                ><strong>{{ c.total }}명</strong><span>제출 대상</span></a
              >
            </div>
            @if (c.employed > 0) {
              <p class="muted">
                취업 중 {{ c.employed }}명은 제외했어요. 임시 저장은 미제출로 셉니다.
              </p>
            }
          </app-card>
        }
        <app-card
          heading="교육생 취업 여부 및 계좌 정보 변경"
          footnote="최근 30일 이내 취업 상태 변경과 계좌 변경 요청이에요. 30초마다 자동으로 갱신돼요."
        >
          <ul class="activity">
            @for (item of activity.items().slice(0, 5); track item.id) {
              <li>
                <a [routerLink]="['/users', item.user.id]">{{ text(item) }}</a>
                <time class="muted" [attr.datetime]="item.occurred_at">{{
                  item.occurred_at.slice(5, 16).replace('T', ' ')
                }}</time>
              </li>
            } @empty {
              <li class="muted">최근 변경 사항이 없어요.</li>
            }
          </ul>
        </app-card>
      </div>
      @if (page(); as page) {
        <app-card
          [heading]="window(page.month).studyLabel + ' 학습 지원금 제출 현황'"
          footnote="최근 제출한 교육생 최대 5명의 제출 상태입니다. 미제출 교육생과 전체 내역은 월별 제출 내역에서 확인할 수 있어요."
        >
          <button
            cardAction
            appButton
            variant="secondary"
            size="sm"
            type="button"
            [routerLink]="['/archive', page.month]"
          >
            파일 일괄 다운로드
          </button>
          <app-data-table>
            <table>
              <thead>
                <tr>
                  <th scope="col">교육생</th>
                  <th scope="col">제출 상태</th>
                </tr>
              </thead>
              <tbody>
                @for (row of page.items; track row.user.id) {
                  <tr>
                    <td>
                      <a [routerLink]="['/users', row.user.id]">{{
                        label(row.user.display_name, row.user)
                      }}</a>
                      <span class="muted login">{{ row.user.login }}</span>
                    </td>
                    <td>
                      @for (chain of row.chains; track chain.root_submission_id) {
                        <div class="chain">
                          <a [routerLink]="['/submissions', chain.latest_submission_id]">{{
                            chain.root_kind === 'initial' ? '최초 4종' : '월별 서류'
                          }}</a>
                          <app-status-badge [status]="chain.status" />
                          @if (chain.supplement_count > 0) {
                            <span class="muted">보완 {{ chain.supplement_count }}회</span>
                          }
                        </div>
                      } @empty {}
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </app-data-table>
          @if (page.items.length === 0) {
            <p class="empty">아직 제출한 교육생이 없어요.</p>
          }
        </app-card>
      } @else if (loading()) {
        <app-card heading="제출 현황">
          <app-spinner size="card" label="선택한 월의 제출 현황을 불러오는 중…" />
        </app-card>
      } @else if (error(); as message) {
        <app-card
          ><p role="alert" class="error">{{ message }}</p>
          <button appButton variant="secondary" type="button" (click)="load()">
            다시 불러오기
          </button></app-card
        >
      }
    }
  `,
  styles: `
    .window {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-1) var(--space-2);
      margin: 0 0 var(--space-2);
      padding: var(--space-1) var(--space-2);
      border-radius: var(--radius-md);
      background: var(--color-mint);
      color: var(--color-teal);
      font-size: var(--font-size-caption);
    }
    .window strong {
      font-weight: var(--font-weight-medium);
    }
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }
    .workflows {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: var(--space-2);
    }
    p {
      margin: 0;
      color: var(--color-muted);
      line-height: 1.7;
    }
    app-card > button {
      margin-top: var(--space-2);
      border-color: color-mix(in srgb, var(--color-teal) 35%, var(--color-surface));
      transition:
        border-color 0.2s ease,
        background-color 0.2s ease,
        color 0.2s ease,
        transform 0.2s ease,
        box-shadow 0.2s ease;
    }
    app-card > button:hover,
    app-card > button:focus-visible {
      border-color: var(--color-teal);
      background: var(--color-mint);
      color: var(--color-teal);
      transform: translateY(-2px);
      box-shadow: 0 4px 12px color-mix(in srgb, var(--color-teal) 18%, transparent);
    }
    app-card > button:active {
      transform: translateY(0);
      box-shadow: none;
    }
    @media (prefers-reduced-motion: reduce) {
      app-card > button {
        transition: none;
      }
      app-card > button:hover,
      app-card > button:focus-visible {
        transform: none;
      }
    }
    a {
      color: var(--color-teal);
      font-weight: var(--font-weight-medium);
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
    .muted {
      color: var(--color-muted);
      font-size: var(--font-size-caption);
    }
    .chain {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--space-1);
      padding: var(--space-1) 0;
    }
    .summary {
      display: flex;
      align-items: flex-start;
      gap: var(--space-2);
    }
    .summary > * {
      flex: 1 1 0;
      min-width: 0;
    }
    .activity {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .activity li {
      display: flex;
      justify-content: space-between;
      gap: var(--space-2);
      padding: var(--space-1) 0;
    }
    .counts {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: var(--space-2);
      text-align: center;
    }
    .counts a {
      padding: var(--space-1);
      border-radius: 8px;
      color: inherit;
      font-weight: inherit;
      text-decoration: none;
    }
    .counts .submitted strong {
      color: var(--color-teal);
    }
    .counts .unsubmitted strong {
      color: var(--color-red);
    }
    .counts .total strong {
      color: var(--color-blue);
    }
    .counts a:hover,
    .counts a:focus-visible {
      background: var(--color-mint);
      text-decoration: none;
    }
    .counts strong {
      text-decoration: underline;
      text-underline-offset: 4px;
      display: block;
      font-size: var(--font-size-title, 1.5rem);
      color: var(--color-text, inherit);
    }
    .counts span {
      color: var(--color-muted);
    }
    .login {
      display: block;
      margin-top: var(--space-1);
    }
    .empty {
      padding-top: var(--space-3);
      text-align: center;
    }
    .error {
      color: var(--color-red);
    }
    @media (max-width: 900px) {
      .summary {
        flex-direction: column;
        align-items: stretch;
      }
      .workflows {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class Dashboard {
  private readonly api = inject(AdminSubmissionsApi);
  protected readonly activity = inject(ActivityService);
  protected readonly text = activityText;
  protected readonly label = studentLabel;
  private readonly destroyed = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  protected readonly months = inject(AdminMonth);
  private request?: Subscription;
  private month?: string;
  protected readonly view = signal<DashboardView | null>(null);
  protected readonly previewing = signal(false);
  protected readonly page = signal<MonthlySubmissions | null>(null);
  protected readonly counts = signal<{
    month: string;
    submitted: number;
    unsubmitted: number;
    total: number;
    employed: number;
  } | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly monthLabel = submissionMonthLabel;
  /** Which month's 학습 지원금 the submissions of this card are judged for, and when */
  protected window(month: string) {
    const w = reviewWindow(month);
    return { studyLabel: `${Number(w.studyMonth.slice(5, 7))}월`, range: w.range };
  }

  constructor() {
    if (typeof ngDevMode === 'undefined' || ngDevMode) {
      if (this.route.snapshot.queryParamMap.has('preview')) {
        this.previewing.set(true);
        void import('../dev/preview-data').then((m) => this.view.set(m.DASHBOARD_PREVIEW));
        return;
      }
    }
    toObservable(this.months.viewing)
      .pipe(distinctUntilChanged(), takeUntilDestroyed(this.destroyed))
      .subscribe((month) => {
        // the window comes from today's date and the arrows, not from the address
        this.month = month;
        this.load();
      });
  }

  protected load(): void {
    this.request?.unsubscribe();
    this.page.set(null);
    this.counts.set(null);
    this.loading.set(true);
    this.error.set(null);
    // The list is ordered by user id, so the newest submitters are found client-side.
    this.request = this.api
      .listWindow({ month: this.month, limit: 50 })
      .pipe(
        expand((page) =>
          page.next_before == null
            ? EMPTY
            : this.api.listWindow({ month: page.month, limit: 50, before: page.next_before }),
        ),
        reduce(
          (all: MonthlySubmissions | null, page) =>
            all ? { ...page, items: [...all.items, ...page.items] } : page,
          null,
        ),
        map((all) => all as MonthlySubmissions),
        map((all) => ({
          page: { ...all, items: recentSubmitters(all.items, 5) },
          counts: countRows(all.items),
        })),
      )
      .pipe(takeUntilDestroyed(this.destroyed))
      .subscribe({
        next: ({ page, counts }) => {
          this.page.set(page);
          this.counts.set({ month: page.month, ...counts });
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.error.set(errorMessage(error));
          this.loading.set(false);
        },
      });
  }
}

/** Only students who have submitted, newest submission first. Drafts never reach this list. */
export function recentSubmitters(rows: MonthlyStudentRow[], count: number): MonthlyStudentRow[] {
  return rows
    .filter((row) => row.chains.length > 0 && row.last_submitted_at)
    .sort((a, b) => Date.parse(b.last_submitted_at!) - Date.parse(a.last_submitted_at!))
    .slice(0, count);
}
