import { TestBed } from '@angular/core/testing';

import { PDF_ANNOTATION_MODE, PDF_LOAD_OPTIONS, PdfViewer } from './pdf-viewer';

describe('PdfViewer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock('pdfjs-dist');
  });

  async function show(fetchImpl: () => Promise<unknown>) {
    vi.stubGlobal('fetch', vi.fn(fetchImpl));
    const fixture = TestBed.createComponent(PdfViewer);
    fixture.componentRef.setInput('fileId', 'f-1');
    fixture.detectChanges();
    return fixture;
  }

  it('reads the file with a same-origin GET /api/files/{id}', async () => {
    const fixture = await show(() => new Promise(() => undefined));
    expect(fetch).toHaveBeenCalledWith('/api/files/f-1', {
      credentials: 'same-origin',
      signal: expect.any(AbortSignal),
    });
    expect(fixture.nativeElement.textContent).toContain('PDF를 불러오고 있어요');
  });

  it('says it could not load and keeps every control off', async () => {
    const fixture = await show(() => Promise.resolve({ ok: false, status: 404 }));
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('PDF를 불러오지 못했어요');
    });
    const buttons = [...fixture.nativeElement.querySelectorAll('button')] as HTMLButtonElement[];
    expect(buttons).toHaveLength(4);
    expect(buttons.every((b) => b.disabled)).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('0 / 0 페이지');
  });

  it('opens documents with scripting-free, form-free options', async () => {
    const render = vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }));
    const page = { getViewport: () => ({ width: 100, height: 100 }), render };
    const destroy = vi.fn(async () => undefined);
    const getDocument = vi.fn(() => ({
      // Match pdf.js 6: the document proxy deliberately has no destroy method.
      promise: Promise.resolve({ numPages: 1, getPage: async () => page }),
      destroy,
    }));
    vi.doMock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument }));
    const fixture = await show(() =>
      Promise.resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }),
    );
    await vi.waitFor(() => expect(render).toHaveBeenCalled());
    expect(() => fixture.destroy()).not.toThrow();
    expect(destroy).toHaveBeenCalledOnce();
    const options = (getDocument.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(options['enableXfa']).toBe(false);
    expect(PDF_LOAD_OPTIONS.enableXfa).toBe(false);
    expect(options).not.toHaveProperty('enableScripting');
    expect((render.mock.calls[0] as unknown[])[0]).toMatchObject({
      annotationMode: PDF_ANNOTATION_MODE,
    });
    expect(PDF_ANNOTATION_MODE).toBe(1); // AnnotationMode.ENABLE, not ENABLE_FORMS (2)
  });

  it('aborts an unfinished file read when leaving, without starting a PDF worker later', async () => {
    let finish!: (response: unknown) => void;
    const getDocument = vi.fn();
    vi.doMock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument }));
    const fixture = await show(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const signal = vi.mocked(fetch).mock.calls[0][1]!.signal!;
    fixture.destroy();
    expect(signal.aborted).toBe(true);
    finish({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getDocument).not.toHaveBeenCalled();
  });

  it('destroys a loading document on a rapid file switch and ignores its late result', async () => {
    let resolveFirst!: (doc: unknown) => void;
    const firstDestroy = vi.fn(async () => undefined);
    const secondDestroy = vi.fn(async () => undefined);
    const render = vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }));
    const page = { getViewport: () => ({ width: 100, height: 100 }), render };
    const getDocument = vi
      .fn()
      .mockReturnValueOnce({
        promise: new Promise((resolve) => {
          resolveFirst = resolve;
        }),
        destroy: firstDestroy,
      })
      .mockReturnValueOnce({
        promise: Promise.resolve({ numPages: 2, getPage: async () => page }),
        destroy: secondDestroy,
      });
    vi.doMock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument }));
    const fixture = await show(() =>
      Promise.resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }),
    );
    await vi.waitFor(() => expect(getDocument).toHaveBeenCalledTimes(1));
    fixture.componentRef.setInput('fileId', 'f-2');
    fixture.detectChanges();
    await vi.waitFor(() => expect(render).toHaveBeenCalled());
    expect(firstDestroy).toHaveBeenCalledOnce();
    const staleGetPage = vi.fn();
    resolveFirst({ numPages: 99, getPage: staleGetPage });
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
    expect(staleGetPage).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('1 / 2 페이지');
    expect(() => fixture.destroy()).not.toThrow();
    expect(secondDestroy).toHaveBeenCalledOnce();
  });
});
