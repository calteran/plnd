import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { YesterdaySnapshotComponent } from './yesterday-snapshot';
import { BriefingService } from '../../../../core/services/briefing.service';
import type { YesterdaySnapshot } from '../../../../core/models/briefing';

function makeMockBriefing(yesterday: YesterdaySnapshot | null, yesterdayError: string | null = null) {
  const y = signal(yesterday);
  const ye = signal(yesterdayError);
  return {
    weather:        signal(null).asReadonly(),
    news:           signal(null).asReadonly(),
    weatherError:   signal(null).asReadonly(),
    newsError:      signal(null).asReadonly(),
    yesterday:      y.asReadonly(),
    yesterdayError: ye.asReadonly(),
    load: vi.fn(),
  };
}

describe('YesterdaySnapshotComponent', () => {
  async function setup(yesterday: YesterdaySnapshot | null, error: string | null = null) {
    const briefing = makeMockBriefing(yesterday, error);
    await TestBed.configureTestingModule({
      imports: [YesterdaySnapshotComponent],
      providers: [{ provide: BriefingService, useValue: briefing }],
    }).compileComponents();
    const f = TestBed.createComponent(YesterdaySnapshotComponent);
    f.detectChanges();
    return f;
  }

  it('displays task and meal counts in X of Y format', async () => {
    const f = await setup({ tasks_done: 4, tasks_total: 6, meals_logged: 2, meals_planned: 3 });
    expect(f.nativeElement.textContent).toContain('4 of 6');
    expect(f.nativeElement.textContent).toContain('2 of 3');
  });

  it('renders nothing when yesterday is null and no error', async () => {
    const f = await setup(null);
    expect(f.nativeElement.textContent.trim()).toBe('');
  });

  it('renders unavailable state when yesterdayError is set', async () => {
    const f = await setup(null, 'Yesterday unavailable');
    expect(f.nativeElement.textContent).toContain('unavailable');
  });

  it('uses "tasks done" label', async () => {
    const f = await setup({ tasks_done: 3, tasks_total: 5, meals_logged: 1, meals_planned: 2 });
    expect(f.nativeElement.textContent).toContain('tasks done');
  });

  it('uses "meals logged" label', async () => {
    const f = await setup({ tasks_done: 0, tasks_total: 0, meals_logged: 3, meals_planned: 3 });
    expect(f.nativeElement.textContent).toContain('meals logged');
  });
});
