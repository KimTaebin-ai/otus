import { HttpEventType, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SubmissionFile } from '../core/api.models';
import { UploadSlot } from './upload-slot';

describe('UploadSlot', () => {
  let fixture: ComponentFixture<UploadSlot>;
  let http: HttpTestingController;
  let el: HTMLElement;

  const uploaded: SubmissionFile = {
    file_id: 'f-1',
    doc_type: 'id_card',
    original_name: 'a.pdf',
    size: 2048,
    uploaded_at: '2026-10-16T21:12:00+09:00',
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(UploadSlot);
    fixture.componentRef.setInput('submissionId', 's-1');
    fixture.componentRef.setInput('docType', 'id_card');
    el = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  afterEach(() => http.verify());

  async function pick(file: File): Promise<void> {
    const input = el.querySelector<HTMLInputElement>('input[type=file]')!;
    const dt = new DataTransfer();
    dt.items.add(file);
    Object.defineProperty(input, 'files', { value: dt.files, configurable: true });
    input.dispatchEvent(new Event('change'));
    // isPdf reads the first bytes asynchronously
    await new Promise((r) => setTimeout(r, 10));
    await fixture.whenStable();
  }

  const pdf = () => new File(['%PDF-1.4 body'], 'a.pdf', { type: 'application/pdf' });

  it('opens the file picker from anywhere on the row, once per click', () => {
    const input = el.querySelector<HTMLInputElement>('input[type=file]')!;
    const spy = vi.spyOn(input, 'click');
    el.querySelector<HTMLElement>('.row .name')!.click();
    expect(spy).toHaveBeenCalledTimes(1);
    el.querySelector<HTMLButtonElement>('.row button.action')!.click();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('opens the preview from anywhere on a view-mode row', async () => {
    fixture.componentRef.setInput('mode', 'view');
    fixture.componentRef.setInput('file', uploaded);
    await fixture.whenStable();
    expect(el.querySelector('app-pdf-preview')).toBeNull();
    el.querySelector<HTMLElement>('.row .name')!.click();
    await fixture.whenStable();
    expect(el.querySelector('app-pdf-preview')).not.toBeNull();
    http.expectOne('/api/files/f-1').flush(new Blob(['%PDF-1.4']));
  });

  it('rejects a non-PDF before sending anything', async () => {
    await pick(new File(['jpg'], 'a.jpg', { type: 'image/jpeg' }));
    expect(el.querySelector('.alert.invalid')?.textContent).toContain('PDF 파일만 제출할 수 있어요');
  });

  it('rejects a .pdf whose bytes are not a PDF', async () => {
    await pick(new File(['hello'], 'a.pdf', { type: 'application/pdf' }));
    expect(el.querySelector('.alert.invalid')).not.toBeNull();
  });

  it('shows progress, then the uploaded row, and emits the file', async () => {
    const emitted: SubmissionFile[] = [];
    fixture.componentInstance.uploaded.subscribe((f) => emitted.push(f));
    await pick(pdf());

    const req = http.expectOne('/api/submissions/s-1/files');
    req.event({ type: HttpEventType.UploadProgress, loaded: 40, total: 100 });
    await fixture.whenStable();
    expect(el.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')).toBe('40');

    req.flush(uploaded);
    await fixture.whenStable();
    expect(el.textContent).toContain('a.pdf · 2 KB');
    expect(el.textContent).toContain('변경');
    expect(emitted).toEqual([uploaded]);
  });

  it('shows the server message in the red box for a 415', async () => {
    await pick(pdf());
    http
      .expectOne('/api/submissions/s-1/files')
      .flush(
        { error: { code: 'NOT_PDF', message: 'PDF 파일이 아닙니다.' } },
        { status: 415, statusText: 'Unsupported Media Type' },
      );
    await fixture.whenStable();
    expect(el.querySelector('.alert.invalid')?.textContent).toContain('PDF 파일이 아닙니다.');
  });

  it('shows the amber box on a network error and retries the same file', async () => {
    await pick(pdf());
    http.expectOne('/api/submissions/s-1/files').error(new ProgressEvent('error'));
    await fixture.whenStable();
    const retry = el.querySelector<HTMLButtonElement>('.alert.failed button')!;
    expect(retry.textContent).toContain('다시 업로드');

    retry.click();
    await fixture.whenStable();
    const again = http.expectOne('/api/submissions/s-1/files');
    expect((again.request.body as FormData).get('file')).toBeInstanceOf(File);
    again.flush(uploaded);
    await fixture.whenStable();
    expect(el.querySelector('.alert')).toBeNull();
  });

  it('kept mode has no pick action', async () => {
    fixture.componentRef.setInput('mode', 'kept');
    fixture.componentRef.setInput('label', '신분증 / 주민등록초본 / 통장사본');
    await fixture.whenStable();
    expect(el.textContent).toContain('유지');
    expect(el.querySelector('button')).toBeNull();
  });
});
