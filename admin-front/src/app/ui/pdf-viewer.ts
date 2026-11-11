import {
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';

/**
 * Safety options, pinned by a test. pdf.js 6.x has no `isEvalSupported` (it never uses eval or
 * `new Function`), `enableScripting` only exists in its full viewer, and a canvas `render()`
 * without an annotation layer cannot follow links or fill forms. `enableXfa` is off by default;
 * it stays explicit so an upgrade cannot turn XFA forms on.
 */
export const PDF_LOAD_OPTIONS = { enableXfa: false } as const;
/** pdf.js `AnnotationMode.ENABLE`: draw annotations flat; no form widgets (`ENABLE_FORMS`) */
export const PDF_ANNOTATION_MODE = 1;

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const ASSETS = '/pdfjs/';

/**
 * Shows one stored PDF page by page on a canvas, with zoom and page controls (the ones in
 * final A02-initial-review-*.png). The file is read with `GET /api/files/{id}` (a same-origin
 * `fetch`, so the download is audited like any other and the sandboxing CSP of that response does
 * not matter) and drawn by pdf.js, which only paints: no scripts and no forms run. pdf.js is a
 * lazy chunk, loaded after the file arrived; its worker, CMaps and fonts are static files under
 * `/pdfjs/` (angular.json "assets"), so the CSP stays `'self'`.
 */
@Component({
  selector: 'app-pdf-viewer',
  template: `
    <div #stage class="stage" [class.busy]="state() === 'loading'">
      @switch (state()) {
        @case ('loading') {
          <p class="msg" role="status">PDF를 불러오고 있어요</p>
        }
        @case ('error') {
          <p class="msg" role="alert">PDF를 불러오지 못했어요. 다운로드로 확인해주세요.</p>
        }
      }
      <canvas #canvas [hidden]="state() !== 'ready'" aria-label="PDF 페이지"></canvas>
    </div>
    <div class="tools">
      <span class="zoom">
        <button
          type="button"
          aria-label="축소"
          [disabled]="state() !== 'ready' || zoomIndex() === 0"
          (click)="zoomBy(-1)"
        >
          −
        </button>
        <span>{{ percent() }}%</span>
        <button
          type="button"
          aria-label="확대"
          [disabled]="state() !== 'ready' || zoomIndex() === maxZoom"
          (click)="zoomBy(1)"
        >
          +
        </button>
      </span>
      <span class="pages">
        <button
          type="button"
          aria-label="이전 페이지"
          [disabled]="state() !== 'ready' || page() <= 1"
          (click)="go(-1)"
        >
          ‹
        </button>
        <span>{{ state() === 'ready' ? page() : 0 }} / {{ pages() }} 페이지</span>
        <button
          type="button"
          aria-label="다음 페이지"
          [disabled]="state() !== 'ready' || page() >= pages()"
          (click)="go(1)"
        >
          ›
        </button>
      </span>
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-height: 0;
    }

    .stage {
      display: flex;
      flex: 1;
      align-items: flex-start;
      justify-content: center;
      min-height: 480px;
      max-height: 560px;
      padding: var(--space-3);
      overflow: auto;
      background: var(--color-mint);
    }

    .msg {
      align-self: center;
      margin: auto;
      font-size: var(--font-size-lead);
      color: var(--color-muted);
    }

    canvas {
      max-width: none;
      background: var(--color-surface);
    }

    @media (max-width: 600px) {
      .stage {
        min-height: 320px;
        padding: var(--space-1);
      }

      .tools {
        padding: 0 var(--space-1);
      }
    }

    .tools {
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 48px;
      padding: 0 var(--space-3);
      font-size: var(--font-size-caption);
      color: var(--color-muted);
    }

    .zoom,
    .pages {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
    }

    button {
      min-width: 28px;
      height: 28px;
      border: 0;
      border-radius: var(--radius-sm);
      background: transparent;
      font: inherit;
      font-size: var(--font-size-label);
      color: var(--color-ink);
      cursor: pointer;
    }

    button:disabled {
      color: var(--color-muted);
      opacity: 0.5;
      cursor: not-allowed;
    }

    button:focus-visible {
      outline: calc(var(--border-width) * 2) solid var(--color-teal);
      outline-offset: calc(var(--border-width) * 2);
    }
  `,
})
export class PdfViewer {
  /** The stored file to show (`GET /api/files/{id}`) */
  readonly fileId = input.required<string>();

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly stage = viewChild.required<ElementRef<HTMLElement>>('stage');
  private doc: PDFDocumentProxy | null = null;
  private loadingTask: PDFDocumentLoadingTask | null = null;
  private request: AbortController | null = null;
  private job = 0;
  private task: RenderTask | null = null;

  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly page = signal(1);
  protected readonly pages = signal(0);
  protected readonly zoomIndex = signal(ZOOMS.indexOf(1));
  protected readonly maxZoom = ZOOMS.length - 1;
  protected percent(): number {
    return Math.round(ZOOMS[this.zoomIndex()] * 100);
  }

  constructor() {
    inject(DestroyRef).onDestroy(() => this.release());
    effect(() => {
      const id = this.fileId();
      untracked(() => void this.load(id));
    });
  }

  protected zoomBy(step: number): void {
    this.zoomIndex.update((i) => Math.min(this.maxZoom, Math.max(0, i + step)));
    void this.draw();
  }

  protected go(step: number): void {
    this.page.update((p) => Math.min(this.pages(), Math.max(1, p + step)));
    void this.draw();
  }

  private release(): void {
    this.job++;
    this.task?.cancel();
    this.task = null;
    this.doc = null;
    this.request?.abort();
    this.request = null;
    // pdf.js 6 owns worker cleanup on the loading task, not PDFDocumentProxy.
    const loadingTask = this.loadingTask;
    this.loadingTask = null;
    void loadingTask?.destroy().catch(() => undefined);
  }

  private async load(id: string): Promise<void> {
    this.release();
    const job = this.job;
    const request = new AbortController();
    this.request = request;
    this.state.set('loading');
    this.page.set(1);
    this.pages.set(0);
    try {
      const res = await fetch(`/api/files/${encodeURIComponent(id)}`, {
        credentials: 'same-origin',
        signal: request.signal,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = new Uint8Array(await res.arrayBuffer());
      if (job !== this.job) return;
      const pdfjs = await import('pdfjs-dist');
      if (job !== this.job) return;
      pdfjs.GlobalWorkerOptions.workerSrc = `${ASSETS}pdf.worker.min.mjs`;
      const loadingTask = pdfjs.getDocument({
        data,
        cMapUrl: `${ASSETS}cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${ASSETS}standard_fonts/`,
        wasmUrl: `${ASSETS}wasm/`,
        ...PDF_LOAD_OPTIONS,
      });
      this.loadingTask = loadingTask;
      const doc = await loadingTask.promise;
      if (job !== this.job) return;
      this.doc = doc;
      this.pages.set(doc.numPages);
      this.state.set('ready');
      await this.draw();
    } catch {
      if (job === this.job) {
        this.state.set('error');
      }
    }
  }

  private async draw(): Promise<void> {
    const doc = this.doc;
    if (!doc) {
      return;
    }
    const job = this.job;
    let page;
    try {
      page = await doc.getPage(this.page());
    } catch {
      // Leaving the route or changing files can cancel an in-flight page read.
      if (job === this.job) this.state.set('error');
      return;
    }
    if (job !== this.job) {
      return;
    }
    const canvas = this.canvas().nativeElement;
    const base = page.getViewport({ scale: 1 });
    const room = Math.max(320, this.stage().nativeElement.clientWidth - 48);
    const scale = (room / base.width) * ZOOMS[this.zoomIndex()];
    const ratio = window.devicePixelRatio || 1;
    const view = page.getViewport({ scale: scale * ratio });
    canvas.width = Math.floor(view.width);
    canvas.height = Math.floor(view.height);
    canvas.style.width = `${Math.floor(view.width / ratio)}px`;
    canvas.style.height = `${Math.floor(view.height / ratio)}px`;
    this.task?.cancel();
    const task = page.render({ canvas, viewport: view, annotationMode: PDF_ANNOTATION_MODE });
    this.task = task;
    try {
      await task.promise;
    } catch {
      // a newer draw cancelled this one
    }
  }
}
