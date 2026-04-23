import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, UrlTree, provideRouter } from '@angular/router';
import { validateDayDateGuard } from './day-redirect.guard';

describe('validateDayDateGuard', () => {
  function routeWithDate(date: string): ActivatedRouteSnapshot {
    return { params: { date } } as unknown as ActivatedRouteSnapshot;
  }

  function run(date: string) {
    return TestBed.runInInjectionContext(() =>
      validateDayDateGuard(routeWithDate(date), null!)
    );
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  describe('valid ISO dates', () => {
    it('allows a normal date', () => {
      expect(run('2026-03-21')).toBe(true);
    });

    it('allows a leap day on a real leap year (2024)', () => {
      expect(run('2024-02-29')).toBe(true);
    });

    it('allows Feb 28 on a non-leap year', () => {
      expect(run('2026-02-28')).toBe(true);
    });

    it('allows Jan 1', () => {
      expect(run('2026-01-01')).toBe(true);
    });

    it('allows Dec 31', () => {
      expect(run('2026-12-31')).toBe(true);
    });
  });

  describe('named aliases redirect to computed ISO dates', () => {
    it('redirects "today" to a UrlTree under /day/', () => {
      const result = run('today');
      expect(result instanceof UrlTree).toBe(true);
      expect((result as UrlTree).toString()).toMatch(/^\/day\/\d{4}-\d{2}-\d{2}$/);
    });

    it('redirects "yesterday" to a UrlTree under /day/', () => {
      const result = run('yesterday');
      expect(result instanceof UrlTree).toBe(true);
      expect((result as UrlTree).toString()).toMatch(/^\/day\/\d{4}-\d{2}-\d{2}$/);
    });

    it('redirects "tomorrow" to a UrlTree under /day/', () => {
      const result = run('tomorrow');
      expect(result instanceof UrlTree).toBe(true);
      expect((result as UrlTree).toString()).toMatch(/^\/day\/\d{4}-\d{2}-\d{2}$/);
    });

    it('yesterday is one day before today', () => {
      const today = (run('today') as UrlTree).toString();
      const yesterday = (run('yesterday') as UrlTree).toString();
      const todayDate = new Date(today.replace('/day/', ''));
      const yesterdayDate = new Date(yesterday.replace('/day/', ''));
      const diff = todayDate.getTime() - yesterdayDate.getTime();
      expect(diff).toBe(24 * 60 * 60 * 1000);
    });
  });

  describe('invalid dates redirect to /not-found', () => {
    function expectNotFound(date: string) {
      const result = run(date);
      expect(result instanceof UrlTree).withContext(`date: "${date}"`).toBe(true);
      expect((result as UrlTree).toString()).withContext(`date: "${date}"`).toBe('/not-found');
    }

    it('rejects a non-numeric string', () => expectNotFound('definitelynotadate'));
    it('rejects month 13', () => expectNotFound('2026-13-01'));
    it('rejects day 32', () => expectNotFound('2026-01-32'));
    it('rejects Feb 30', () => expectNotFound('2026-02-30'));
    it('rejects Feb 29 on a non-leap year (2026)', () => expectNotFound('2026-02-29'));
    it('rejects April 31', () => expectNotFound('2026-04-31'));
    it('rejects slash-separated date', () => expectNotFound('2026/03/21'));
    it('rejects empty string', () => expectNotFound(''));
    it('rejects partial date', () => expectNotFound('2026-03'));
  });
});
