import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { DayHeaderComponent } from './day-header';

const now = new Date();
const TODAY = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const OTHER = '2026-01-01';

describe('DayHeaderComponent', () => {
  async function setup(date: string) {
    await TestBed.configureTestingModule({ imports: [DayHeaderComponent] }).compileComponents();
    const fixture = TestBed.createComponent(DayHeaderComponent);
    fixture.componentRef.setInput('date', date);
    fixture.detectChanges();
    return fixture;
  }

  it('displays TODAY badge when date is today', async () => {
    const f = await setup(TODAY);
    expect(f.nativeElement.textContent).toContain('Today');
  });

  it('does not display TODAY badge for other dates', async () => {
    const f = await setup(OTHER);
    expect(f.nativeElement.textContent).not.toContain('Today');
  });

  it('emits previous date when ‹ clicked', async () => {
    const f = await setup('2026-03-19');
    let emitted: string | undefined;
    f.componentInstance.dateChange.subscribe((d: string) => emitted = d);
    const prev = f.debugElement.query(By.css('[aria-label="Previous day"]'));
    prev.nativeElement.click();
    expect(emitted).toBe('2026-03-18');
  });

  it('emits next date when › clicked', async () => {
    const f = await setup('2026-03-19');
    let emitted: string | undefined;
    f.componentInstance.dateChange.subscribe((d: string) => emitted = d);
    const next = f.debugElement.query(By.css('[aria-label="Next day"]'));
    next.nativeElement.click();
    expect(emitted).toBe('2026-03-20');
  });
});
