import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import {
  MonoTypeOperatorFunction,
  Subscription,
  exhaustMap,
  filter,
  finalize,
  map,
  retry,
  take,
  takeWhile,
  tap,
  throwError,
  timer,
} from 'rxjs';

import {
  ArchiveFilter,
  ArchiveCriteria,
  ArchiveOptions,
  ArchiveRow,
  ArchiveView,
  DEFAULT_ARCHIVE_OPTIONS,
  DEFAULT_ARCHIVE_CRITERIA,
  DownloadStatus,
} from './admin.models';
import {
  ArchiveApi,
  ArchiveExportRequest,
  ArchiveExportStatus,
  ArchiveFileSaver,
  archiveFilters,
  toArchiveView,
} from './archive-api';
import { NO_DOWNLOAD_NOTE, NOTHING_SELECTED_NOTE } from './archive-copy';
import { planArchive } from './archive-plan';
import { AuthService } from './auth.service';
import { errorMessage } from './api.service';
import { canDownloadArchive } from './roles';
import { visibleRows } from './archive-select';

interface ExportIntent {
  month: string;
  key: string;
  body: ArchiveExportRequest;
  rows: ArchiveRow[];
  options: ArchiveOptions;
  criteria: ArchiveCriteria;
}

/** Real API state shared by archive, options and download routes. */
@Injectable({ providedIn: 'root' })
export class ArchiveState {
  private readonly auth = inject(AuthService);
  private readonly api = inject(ArchiveApi);
  private readonly saver = inject(ArchiveFileSaver);
  private month: string | null = null;
  private owner = this.auth.me()?.id ?? null;
  private listRequest?: Subscription;
  private createRequest?: Subscription;
  private polling?: Subscription;
  private fileRequest?: Subscription;
  /** Retained only when the server may have committed a POST whose response was lost. */
  private uncertainIntent: ExportIntent | null = null;
  private readonly intent = signal<ExportIntent | null>(null);
  private readonly forbidden = signal(false);

  readonly canDownload = computed(() => {
    const me = this.auth.me();
    return !!me && canDownloadArchive(me.role) && !this.forbidden();
  });
  readonly view = signal<ArchiveView | null>(null);
  readonly loading = signal(false);
  readonly listError = signal<string | null>(null);
  readonly selected = signal<ReadonlySet<number>>(new Set());
  readonly options = signal<ArchiveOptions>({ ...DEFAULT_ARCHIVE_OPTIONS });
  /** Null means that the user has not requested an export. */
  readonly status = signal<DownloadStatus | null>(null);
  readonly job = signal<ArchiveExportStatus | null>(null);
  readonly jobId = signal<string | null>(null);
  readonly receiving = signal(false);
  readonly retryAfter = signal(0);
  readonly downloadStarted = signal(false);
  readonly error = signal<string | null>(null);
  readonly expired = signal(false);
  readonly preview = signal(false);
  readonly busy = computed(() => this.status() === 'creating' || this.receiving());
  readonly selectedRows = computed<ArchiveRow[]>(() =>
    visibleRows(
      this.view()?.rows ?? [],
      this.query(),
      this.filter(),
      this.selected(),
      this.criteria(),
    ).filter((r) => this.selected().has(r.userId)),
  );
  readonly downloadRows = computed(() => this.intent()?.rows ?? this.selectedRows());
  readonly downloadOptions = computed(() => this.intent()?.options ?? this.options());
  readonly downloadCriteria = computed(() => this.intent()?.criteria ?? this.criteria());
  readonly query = signal('');
  readonly filter = signal<ArchiveFilter>('all');
  readonly criteria = signal<ArchiveCriteria>({ ...DEFAULT_ARCHIVE_CRITERIA });

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.listRequest?.unsubscribe();
      this.stopJobRequests();
    });
    effect(() => this.syncOwner());
  }

  /** Options/download route visits read rows, but never create a ZIP. */
  load(month: string, force = false, selectMatches = false): void {
    this.syncOwner();
    if (!force && !this.preview() && this.view()?.month === month) return;
    this.listRequest?.unsubscribe();
    const changed = this.month !== month || this.preview();
    this.preview.set(false);
    if (changed) {
      this.resetExport();
      this.view.set(null);
      this.month = null;
      this.criteria.set({ ...DEFAULT_ARCHIVE_CRITERIA });
    }
    this.loading.set(true);
    this.listError.set(null);
    this.listRequest = this.api.list(month, this.criteria()).subscribe({
      next: (response) => {
        this.show(toArchiveView(response));
        if (selectMatches) this.selected.set(new Set(response.rows.map((row) => row.user_id)));
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.view.set(null);
        this.loading.set(false);
        this.listError.set(errorMessage(error));
      },
    });
  }

  show(view: ArchiveView): void {
    this.view.set(view);
    if (this.month === view.month) {
      const valid = new Set(view.rows.map((r) => r.userId));
      this.selected.update((selected) => new Set([...selected].filter((id) => valid.has(id))));
      return;
    }
    this.month = view.month;
    this.selected.set(new Set(view.rows.map((r) => r.userId)));
    this.options.set({ ...DEFAULT_ARCHIVE_OPTIONS });
    this.query.set('');
    this.filter.set('all');
  }

  usePreview(): void {
    if (this.preview()) return;
    this.listRequest?.unsubscribe();
    this.resetExport();
    this.preview.set(true);
    this.view.set(null);
    this.month = null;
    this.loading.set(false);
    this.listError.set(null);
    this.status.set('ready');
  }

  setOption(key: keyof ArchiveOptions, on: boolean): void {
    this.options.update((o) => ({ ...o, [key]: on }));
  }

  setCriteria(criteria: ArchiveCriteria): void {
    if (this.busy() && !this.preview()) return;
    if (
      JSON.stringify(archiveFilters(criteria)) === JSON.stringify(archiveFilters(this.criteria()))
    )
      return;
    this.criteria.set({ status: [...criteria.status], kind: [...criteria.kind] });
    this.resetExport();
    if (this.month && !this.preview()) this.load(this.month, true, true);
  }

  resetFilters(): void {
    this.query.set('');
    this.filter.set('all');
    this.setCriteria({ ...DEFAULT_ARCHIVE_CRITERIA });
  }

  toggle(userId: number): void {
    this.setMany([userId], !this.selected().has(userId));
  }

  setMany(userIds: readonly number[], on: boolean): void {
    const valid = new Set(this.view()?.rows.map((r) => r.userId));
    const next = new Set(this.selected());
    for (const id of userIds) {
      if (on && valid.has(id)) next.add(id);
      else next.delete(id);
    }
    this.selected.set(next);
  }

  /** Called only from an explicit download/retry button, never a constructor. */
  startExport(): boolean {
    this.syncOwner();
    if (this.preview()) return true;
    if (this.busy() || this.loading()) return false;
    const view = this.view();
    if (!view || !this.canDownload() || this.selectedRows().length === 0) {
      this.error.set(!this.canDownload() ? NO_DOWNLOAD_NOTE : NOTHING_SELECTED_NOTE);
      return false;
    }
    const options = { ...this.options() };
    const rows = [...this.selectedRows()];
    const body: ArchiveExportRequest = {
      user_ids: rows.map((r) => r.userId),
      include_base_docs: options.baseDocs,
      include_previous: options.previous,
      expected_pdf_count: planArchive(view.month, rows, options).pdfCount,
    };
    const criteria = this.criteria();
    const filters = archiveFilters(criteria);
    if (filters) body.filters = filters;
    const previous = this.uncertainIntent;
    const intent =
      previous?.month === view.month && JSON.stringify(previous.body) === JSON.stringify(body)
        ? previous
        : { month: view.month, key: crypto.randomUUID(), body, rows, options, criteria };
    this.stopJobRequests();
    this.intent.set(intent);
    this.uncertainIntent = intent;
    this.status.set('creating');
    this.job.set(null);
    this.jobId.set(null);
    this.receiving.set(false);
    this.downloadStarted.set(false);
    this.error.set(null);
    this.expired.set(false);
    this.createRequest = this.api
      .create(intent.month, intent.body, intent.key)
      .pipe(this.retryRateLimit())
      .subscribe({
        next: (created) => {
          this.uncertainIntent = null;
          this.jobId.set(created.job_id);
          this.poll(intent.month, created.job_id);
        },
        error: (error: unknown) => {
          if (!(error instanceof HttpErrorResponse) || (error.status !== 0 && error.status < 500)) {
            this.uncertainIntent = null;
          }
          this.fail(error);
          if (error instanceof HttpErrorResponse && error.status === 409) {
            this.load(intent.month, true);
          }
        },
      });
    return true;
  }

  retry(): void {
    this.syncOwner();
    if (this.busy()) return;
    const job = this.job();
    const intent = this.intent();
    if (job?.status === 'ready' && !this.expired() && intent && this.canDownload()) {
      this.receive(intent.month, job);
    } else if (
      this.jobId() &&
      job?.status !== 'failed' &&
      !this.expired() &&
      intent &&
      this.canDownload()
    ) {
      this.status.set('creating');
      this.error.set(null);
      this.poll(intent.month, this.jobId()!);
    } else {
      this.startExport();
    }
  }

  cancelWait(): void {
    this.stopJobRequests();
    this.receiving.set(false);
    this.status.set(this.job()?.status === 'ready' ? 'ready' : null);
    this.error.set(null);
  }

  /** Retry only an explicit request, preserving its body, key and existing job. */
  private retryRateLimit<T>(): MonoTypeOperatorFunction<T> {
    return retry({
      count: 3,
      delay: (error: unknown) => {
        if (!(error instanceof HttpErrorResponse) || error.status !== 429) {
          return throwError(() => error);
        }
        const header = error.headers.get('Retry-After');
        const parsed = header && /^\d+$/.test(header) ? Number(header) : NaN;
        // The API uses seconds. Missing/invalid headers still get a bounded delay.
        const seconds = Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 86400 ? parsed : 30;
        const until = Date.now() + seconds * 1000;
        this.retryAfter.set(seconds);
        return timer(0, 250).pipe(
          map(() => Math.max(0, Math.ceil((until - Date.now()) / 1000))),
          tap((remaining) => this.retryAfter.set(remaining)),
          filter((remaining) => remaining === 0),
          take(1),
          finalize(() => this.retryAfter.set(0)),
        );
      },
    });
  }

  private poll(month: string, id: string): void {
    this.polling?.unsubscribe();
    this.polling = timer(0, 1500)
      .pipe(
        exhaustMap(() => this.api.status(month, id).pipe(this.retryRateLimit())),
        takeWhile((job) => job.status === 'creating', true),
      )
      .subscribe({
        next: (job) => {
          this.job.set(job);
          this.status.set(job.status);
          if (job.status === 'ready') this.receive(month, job);
          if (job.status === 'failed') {
            this.error.set(job.error ?? 'ZIP 파일을 만들지 못했습니다. 다시 요청해 주세요.');
          }
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  private receive(month: string, job: ArchiveExportStatus): void {
    if (this.receiving()) return;
    this.status.set('ready');
    this.receiving.set(true);
    this.downloadStarted.set(false);
    this.error.set(null);
    this.fileRequest = this.api
      .file(month, job.job_id)
      .pipe(this.retryRateLimit())
      .subscribe({
        next: (response) => {
          try {
            if (
              !response.body ||
              response.body.size === 0 ||
              response.headers.get('Content-Type')?.split(';')[0] !== 'application/zip'
            ) {
              throw new Error('invalid download response');
            }
            this.saver.save(response.body, job.zip_name);
            this.downloadStarted.set(true);
            this.receiving.set(false);
          } catch {
            this.fail(new Error('browser save failed'));
          }
        },
        error: (error: unknown) => this.fail(error),
      });
  }

  private fail(error: unknown): void {
    this.receiving.set(false);
    this.status.set('failed');
    this.downloadStarted.set(false);
    if (error instanceof HttpErrorResponse && error.status === 404) {
      this.expired.set(true);
      this.error.set('다운로드 작업이 만료되었거나 없습니다. 자료를 확인하고 새로 만들어 주세요.');
    } else if (error instanceof HttpErrorResponse && error.status === 403) {
      this.forbidden.set(true);
      this.error.set(NO_DOWNLOAD_NOTE);
    } else {
      this.error.set(errorMessage(error));
    }
  }

  private stopJobRequests(): void {
    this.createRequest?.unsubscribe();
    this.polling?.unsubscribe();
    this.fileRequest?.unsubscribe();
  }

  private syncOwner(): void {
    const owner = this.auth.me()?.id ?? null;
    if (owner === this.owner) return;
    this.owner = owner;
    this.listRequest?.unsubscribe();
    this.resetExport();
    this.month = null;
    this.view.set(null);
    this.preview.set(false);
    this.selected.set(new Set());
    this.loading.set(false);
    this.listError.set(null);
    this.forbidden.set(false);
    this.query.set('');
    this.filter.set('all');
    this.criteria.set({ ...DEFAULT_ARCHIVE_CRITERIA });
  }

  private resetExport(): void {
    this.stopJobRequests();
    this.uncertainIntent = null;
    this.intent.set(null);
    this.job.set(null);
    this.jobId.set(null);
    this.status.set(null);
    this.receiving.set(false);
    this.downloadStarted.set(false);
    this.error.set(null);
    this.expired.set(false);
  }
}
