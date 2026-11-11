import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';

import { AuthService } from '../core/auth.service';
import { ProfileSetup, parseCohort, validBirthDate, validKoreanName } from './profile-setup';

describe('profile validation', () => {
  it('accepts only the listed cohorts', () => {
    for (const ok of ['3A', '3B', '3C', '4A', '4B', 'ended', 'transfer']) {
      expect(parseCohort(ok)).toBe(ok);
    }
    for (const bad of ['', '3D', '5A', 'a']) {
      expect(parseCohort(bad)).toBeNull();
    }
  });

  it('accepts a Korean name of 2-20 characters without spaces', () => {
    expect(validKoreanName('홍길동')).toBe(true);
    for (const bad of ['', '홍', 'Kim', '홍 길동', '홍길동1']) {
      expect(validKoreanName(bad)).toBe(false);
    }
  });
});

describe('validBirthDate', () => {
  it('accepts real dates from 1900-01-01 (the server checks the upper bound)', () => {
    expect(validBirthDate('2003-04-21')).toBe(true);
    expect(validBirthDate('1900-01-01')).toBe(true);
  });

  it('rejects too early, impossible and malformed dates', () => {
    for (const bad of ['1899-12-31', '2003-02-30', '2003-4-21', '', '030421']) {
      expect(validBirthDate(bad)).toBe(false);
    }
  });
});

describe('ProfileSetup', () => {
  it('saves the profile, updates the user and goes on to 최초 4종', async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    const http = TestBed.inject(HttpTestingController);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(ProfileSetup);
    const el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();

    const button = el.querySelector<HTMLButtonElement>('button[type=submit]')!;
    expect(button.disabled).toBe(true);

    const labels = [...el.querySelectorAll('#cohort option')].map((o) => o.textContent?.trim());
    expect(labels).toEqual([
      '기수를 선택해주세요',
      '3기 A',
      '3기 B',
      '3기 C',
      '4기 A',
      '4기 B',
      '지원금 지급 종료',
      '트랜스퍼 교육생',
    ]);
    const select = el.querySelector<HTMLSelectElement>('#cohort')!;
    select.value = '4B';
    select.dispatchEvent(new Event('change'));
    const input = el.querySelector<HTMLInputElement>('#korean-name')!;
    input.value = '홍길동';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(button.disabled).toBe(true);
    const birth = el.querySelector<HTMLInputElement>('#birth-date')!;
    birth.value = '2003-04-21';
    birth.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(button.disabled).toBe(false);

    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    const req = http.expectOne('/api/me/profile');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({
      ordinal: '4B',
      ko_name: '홍길동',
      date_of_birth: '2003-04-21',
    });
    const me = {
      id: 1,
      login: 'dongmin',
      ordinal: '4B',
      ko_name: '홍길동',
      date_of_birth: '2003-04-21',
      initial_submitted: false,
    };
    req.flush(me);

    expect(TestBed.inject(AuthService).me()).toMatchObject({ ordinal: '4B' });
    expect(navigate).toHaveBeenCalledWith('/initial');
    http.verify();
  });
});
