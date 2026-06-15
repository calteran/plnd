import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { DayHeaderComponent } from './day-header';
import { DayZoneView } from '../../../../core/utils/zone-projection';

const now = new Date();
const TODAY = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const OTHER = '2026-01-01';

describe('DayHeaderComponent', () => {
  async function setup(date: string, zoneView?: DayZoneView | null) {
    await TestBed.configureTestingModule({ imports: [DayHeaderComponent] }).compileComponents();
    const fixture = TestBed.createComponent(DayHeaderComponent);
    fixture.componentRef.setInput('date', date);
    if (zoneView !== undefined) {
      fixture.componentRef.setInput('zoneView', zoneView);
    }
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

  describe('zone display — divergent', () => {
    const divergentView: DayZoneView = {
      kind: 'divergent',
      incomingZone: 'America/Denver',
      currentZone: 'America/New_York',
    };

    it('renders the zone chip with city and short code', async () => {
      const f = await setup('2026-07-10', divergentView);
      const chip = f.debugElement.query(By.css('.tz-chip'));
      expect(chip).toBeTruthy();
      expect(chip.nativeElement.textContent.trim()).toBe('DENVER · MT');
    });

    it('renders subtext with long zone name', async () => {
      const f = await setup('2026-07-10', divergentView);
      const subtext = f.debugElement.query(By.css('.tz-subtext'));
      expect(subtext).toBeTruthy();
      expect(subtext.nativeElement.textContent).toContain('Mountain Time');
    });

    it('renders subtext with offset phrase', async () => {
      const f = await setup('2026-07-10', divergentView);
      const subtext = f.debugElement.query(By.css('.tz-subtext'));
      expect(subtext.nativeElement.textContent).toContain('2h behind your current zone');
    });

    it('clicking .tz-why emits whyClicked', async () => {
      const f = await setup('2026-07-10', divergentView);
      let emitted = false;
      f.componentInstance.whyClicked.subscribe(() => emitted = true);
      const why = f.debugElement.query(By.css('.tz-why'));
      expect(why).toBeTruthy();
      why.nativeElement.click();
      expect(emitted).toBeTrue();
    });
  });

  describe('zone display — travel', () => {
    const travelView: DayZoneView = {
      kind: 'travel',
      incomingZone: 'America/Denver',
      currentZone: 'America/Denver',
      switch: {
        fromZone: 'America/Denver',
        toZone: 'America/Los_Angeles',
        anchor: {
          id: 'a1',
          user_id: 'u1',
          zone: 'America/Los_Angeles',
          effective_date: '2026-07-10',
          effective_time: '12:00:00',
          source: 'device',
          source_ref: null,
          inference_group: null,
          created_at: '2026-07-10T00:00:00Z',
          updated_at: '2026-07-10T00:00:00Z',
        },
      },
    };

    it('renders TRAVEL DAY pill', async () => {
      const f = await setup('2026-07-10', travelView);
      const pill = f.debugElement.query(By.css('.tz-pill'));
      expect(pill).toBeTruthy();
      expect(pill.nativeElement.textContent.trim()).toBe('TRAVEL DAY');
    });

    it('does not render .tz-subtext', async () => {
      const f = await setup('2026-07-10', travelView);
      expect(f.debugElement.query(By.css('.tz-subtext'))).toBeNull();
    });

    it('does not render .tz-why', async () => {
      const f = await setup('2026-07-10', travelView);
      expect(f.debugElement.query(By.css('.tz-why'))).toBeNull();
    });
  });

  describe('zone display — same / null', () => {
    it('renders nothing when zoneView is null', async () => {
      const f = await setup('2026-07-10', null);
      expect(f.debugElement.query(By.css('.tz-banner'))).toBeNull();
      expect(f.debugElement.query(By.css('.tz-pill'))).toBeNull();
    });

    it('renders nothing when zoneView kind is same', async () => {
      const sameView: DayZoneView = {
        kind: 'same',
        incomingZone: 'America/New_York',
        currentZone: 'America/New_York',
      };
      const f = await setup('2026-07-10', sameView);
      expect(f.debugElement.query(By.css('.tz-banner'))).toBeNull();
      expect(f.debugElement.query(By.css('.tz-pill'))).toBeNull();
    });

    it('renders nothing when zoneView is not provided', async () => {
      const f = await setup('2026-07-10');
      expect(f.debugElement.query(By.css('.tz-banner'))).toBeNull();
      expect(f.debugElement.query(By.css('.tz-pill'))).toBeNull();
    });
  });
});
