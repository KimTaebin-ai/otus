import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { Me } from '../core/api.models';
import { AuthService } from '../core/auth.service';
import { ProfileEdit } from './profile-edit';

const me = { id: 1, login: 'dongmin', ordinal: '3A', ko_name: '홍길동' } as Me;

describe('ProfileEdit', () => {
  it('sends only the changed fields with PATCH and updates the user', () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const http = TestBed.inject(HttpTestingController);
    TestBed.inject(AuthService).setMe(me);
    const fixture = TestBed.createComponent(ProfileEdit);
    const el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();

    const save = el.querySelector<HTMLButtonElement>('button[type=submit]')!;
    expect(save.disabled).toBe(true);

    const input = el.querySelector<HTMLInputElement>('#edit-ko-name')!;
    expect(input.value).toBe('홍길동');
    input.value = '김철수';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(save.disabled).toBe(false);

    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    const req = http.expectOne('/api/me/profile');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ ko_name: '김철수' });
    req.flush({ ...me, ko_name: '김철수' });
    fixture.detectChanges();

    expect(TestBed.inject(AuthService).me()?.ko_name).toBe('김철수');
    expect(el.textContent).toContain('저장했어요');
    http.verify();
  });

  it('sends a changed 생년월일', () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const http = TestBed.inject(HttpTestingController);
    TestBed.inject(AuthService).setMe({ ...me, date_of_birth: '2003-04-21' });
    const fixture = TestBed.createComponent(ProfileEdit);
    const el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    const input = el.querySelector<HTMLInputElement>('#edit-birth')!;
    expect(input.value).toBe('2003-04-21');
    input.value = '2003-04-22';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    const req = http.expectOne('/api/me/profile');
    expect(req.request.body).toEqual({ date_of_birth: '2003-04-22' });
    req.flush({ ...me, date_of_birth: '2003-04-22' });
    http.verify();
  });

  it('blocks an invalid name', () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    TestBed.inject(AuthService).setMe(me);
    const fixture = TestBed.createComponent(ProfileEdit);
    const el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    const input = el.querySelector<HTMLInputElement>('#edit-ko-name')!;
    input.value = 'Kim';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
    expect(el.querySelector('[role=alert]')).not.toBeNull();
  });
});
