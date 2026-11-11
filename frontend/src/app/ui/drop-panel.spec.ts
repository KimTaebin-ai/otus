import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DropPanel } from './drop-panel';

const pdf = () =>
  new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])], '고용보험_10월.pdf', {
    type: 'application/pdf',
  });

describe('DropPanel', () => {
  let fixture: ComponentFixture<DropPanel>;
  let http: HttpTestingController;
  let el: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(DropPanel);
    fixture.componentRef.setInput('docType', 'employment_insurance');
    fixture.componentRef.setInput('submissionId', 'm-1');
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  const panel = () => el.querySelector<HTMLElement>('.panel')!;

  function drop(files: File[]): void {
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { files } });
    panel().dispatchEvent(event);
  }

  it('starts empty with the drop zone and the picker button', () => {
    expect(el.textContent).toContain('준비한 PDF를 여기에 놓아주세요');
    expect(el.querySelector('button')?.textContent?.trim()).toBe('PDF 파일 선택');
    expect(panel().classList).not.toContain('ready');
  });

  it('turns the border teal while a file is dragged over, and back on leave', () => {
    panel().dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(panel().classList).toContain('dragging');
    panel().dispatchEvent(new Event('dragleave', { bubbles: true }));
    fixture.detectChanges();
    expect(panel().classList).not.toContain('dragging');
  });

  it('uploads a dropped PDF and shows the ready panel with "파일 변경" only', async () => {
    let emitted: unknown;
    fixture.componentInstance.uploaded.subscribe((f) => (emitted = f));
    drop([pdf()]);
    await fixture.whenStable();
    const req = http.expectOne('/api/submissions/m-1/files');
    expect((req.request.body as FormData).get('doc_type')).toBe('employment_insurance');
    const body = {
      file_id: 'f-1',
      doc_type: 'employment_insurance',
      original_name: '고용보험_10월.pdf',
      size: 1843200,
      uploaded_at: '2026-10-16T21:12:00+09:00',
    };
    req.flush(body);
    fixture.detectChanges();

    expect(emitted).toEqual(body);
    expect(panel().classList).toContain('ready');
    expect(el.textContent).toContain('파일이 준비됐어요');
    expect(el.textContent).toContain('고용보험_10월.pdf · 1.8 MB');
    expect(el.textContent).not.toContain('미리보기');
    expect([...el.querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual([
      '파일 변경',
    ]);
  });

  it('refuses a non-PDF without calling the server', async () => {
    drop([new File(['x'], '사진.jpg', { type: 'image/jpeg' })]);
    await fixture.whenStable();
    fixture.detectChanges();
    http.expectNone('/api/submissions/m-1/files');
    expect(el.querySelector('.alert.invalid')?.textContent).toContain(
      'PDF 파일만 제출할 수 있어요',
    );
  });

  it('ignores a drop while disabled', async () => {
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    drop([pdf()]);
    await fixture.whenStable();
    http.expectNone('/api/submissions/m-1/files');
  });
});
