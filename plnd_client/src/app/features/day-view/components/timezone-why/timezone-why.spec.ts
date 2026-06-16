import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { TimezoneWhyComponent } from './timezone-why';
import { TimezoneAnchorDto } from '../../../../core/models/timezone';

function baseAnchor(overrides: Partial<TimezoneAnchorDto> = {}): TimezoneAnchorDto {
  return {
    id: 'test-id',
    user_id: 'user-1',
    effective_date: '2026-06-14',
    effective_time: null,
    zone: 'America/Denver',
    source: 'device',
    source_ref: null,
    source_title: null,
    inference_group: null,
    created_at: '2026-06-14T00:00:00Z',
    updated_at: '2026-06-14T00:00:00Z',
    ...overrides,
  };
}

describe('TimezoneWhyComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TimezoneWhyComponent],
    }).compileComponents();
  });

  it('renders "From your device" for device source', () => {
    const f = TestBed.createComponent(TimezoneWhyComponent);
    f.componentRef.setInput('anchor', baseAnchor({ source: 'device' }));
    f.componentRef.setInput('currentZone', 'America/Denver');
    f.detectChanges();
    const p = f.debugElement.query(By.css('.tz-why-pop__provenance'));
    expect(p.nativeElement.textContent.trim()).toBe('From your device');
  });

  it('renders "Set by you on Jun 14" for user source with effective_date 2026-06-14', () => {
    const f = TestBed.createComponent(TimezoneWhyComponent);
    f.componentRef.setInput('anchor', baseAnchor({ source: 'user', effective_date: '2026-06-14' }));
    f.componentRef.setInput('currentZone', 'America/Denver');
    f.detectChanges();
    const p = f.debugElement.query(By.css('.tz-why-pop__provenance'));
    expect(p.nativeElement.textContent.trim()).toBe('Set by you on Jun 14');
  });

  it('renders inferred provenance with source label and weekday for 2026-06-18 (Thursday)', () => {
    const f = TestBed.createComponent(TimezoneWhyComponent);
    f.componentRef.setInput('anchor', baseAnchor({ source: 'inferred', effective_date: '2026-06-18' }));
    f.componentRef.setInput('currentZone', 'America/Denver');
    f.componentRef.setInput('sourceLabel', 'Flight to DEN');
    f.detectChanges();
    const p = f.debugElement.query(By.css('.tz-why-pop__provenance'));
    expect(p.nativeElement.textContent.trim()).toBe('Inferred from "Flight to DEN" on Thursday');
  });

  it('renders "Inferred from your travel plans" when no sourceLabel provided', () => {
    const f = TestBed.createComponent(TimezoneWhyComponent);
    f.componentRef.setInput('anchor', baseAnchor({ source: 'inferred', effective_date: '2026-06-18' }));
    f.componentRef.setInput('currentZone', 'America/Denver');
    f.detectChanges();
    const p = f.debugElement.query(By.css('.tz-why-pop__provenance'));
    expect(p.nativeElement.textContent.trim()).toBe('Inferred from your travel plans');
  });

  it('emits useCurrent when "Use my current zone" button is clicked', () => {
    const f = TestBed.createComponent(TimezoneWhyComponent);
    f.componentRef.setInput('anchor', baseAnchor());
    f.componentRef.setInput('currentZone', 'America/Denver');
    f.detectChanges();

    let emitted = false;
    f.componentRef.instance.useCurrent.subscribe(() => (emitted = true));

    const btn = f.debugElement.queryAll(By.css('.tz-why-pop__btn'))
      .find(b => b.nativeElement.textContent.trim() === 'Use my current zone')!;
    btn.nativeElement.click();
    f.detectChanges();
    expect(emitted).toBeTrue();
  });

  it('shows zone select after clicking "Pick a different zone…" and emits pickZone on selection', () => {
    const f = TestBed.createComponent(TimezoneWhyComponent);
    f.componentRef.setInput('anchor', baseAnchor());
    f.componentRef.setInput('currentZone', 'America/Denver');
    f.detectChanges();

    // "Pick a different zone…" button should be visible initially
    const pickBtn = f.debugElement.queryAll(By.css('.tz-why-pop__btn--ghost'))
      .find(b => b.nativeElement.textContent.trim() === 'Pick a different zone…')!;
    expect(pickBtn).toBeTruthy();

    pickBtn.nativeElement.click();
    f.detectChanges();

    // Select should now be visible
    const select = f.debugElement.query(By.css('.tz-why-pop__select'));
    expect(select).toBeTruthy();

    let emittedZone: string | undefined;
    f.componentRef.instance.pickZone.subscribe((z: string) => (emittedZone = z));

    // Simulate selecting a zone
    select.nativeElement.value = 'America/New_York';
    select.nativeElement.dispatchEvent(new Event('change'));
    f.detectChanges();

    expect(emittedZone).toBe('America/New_York');
  });
});
