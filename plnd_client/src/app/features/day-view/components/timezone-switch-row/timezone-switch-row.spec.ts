import { TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { By } from '@angular/platform-browser';
import { TimezoneSwitchRowComponent } from './timezone-switch-row';
import { DaySwitch } from '../../../../core/utils/zone-projection';
import { TimezoneAnchorDto } from '../../../../core/models/timezone';
import { zoneLong } from '../../../../core/utils/zone-format';

const minimalAnchor: TimezoneAnchorDto = {
  id: 'test-anchor-1',
  user_id: 'test-user-1',
  effective_date: '2026-07-10',
  effective_time: '14:00:00',
  zone: 'Pacific/Honolulu',
  source: 'user',
  source_ref: null,
  inference_group: null,
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
};

const testSwitch: DaySwitch = {
  fromZone: 'America/Denver',
  toZone: 'Pacific/Honolulu',
  anchor: minimalAnchor,
};

@Component({
  standalone: true,
  imports: [TimezoneSwitchRowComponent],
  template: `
    <app-timezone-switch-row
      [switch]="sw"
      [date]="date"
      (whyClicked)="whyCount = whyCount + 1"
    />
  `,
})
class HostComponent {
  sw: DaySwitch = testSwitch;
  date = '2026-07-10';
  whyCount = 0;
}

describe('TimezoneSwitchRowComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
  });

  it('renders Switch to <zone label> with the actual Intl long name for Pacific/Honolulu', () => {
    const f = TestBed.createComponent(HostComponent);
    f.detectChanges();
    const label = f.debugElement.query(By.css('.tz-switch-row__label'));
    // Derive the expected label from the same Intl call the component uses,
    // so the test is ICU-independent (may be "Hawaii Time" or "Hawaii-Aleutian Time").
    const expectedZoneLabel = zoneLong('Pacific/Honolulu', new Date(2026, 6, 10, 12, 0, 0));
    expect(label.nativeElement.textContent).toContain(`Switch to ${expectedZoneLabel}`);
  });

  it('renders "(4 hours earlier)" offset phrase (ICU-independent arithmetic)', () => {
    const f = TestBed.createComponent(HostComponent);
    f.detectChanges();
    const label = f.debugElement.query(By.css('.tz-switch-row__label'));
    expect(label.nativeElement.textContent).toContain('4 hours earlier');
  });

  it('renders the ✈ icon', () => {
    const f = TestBed.createComponent(HostComponent);
    f.detectChanges();
    const icon = f.debugElement.query(By.css('.tz-switch-row__icon'));
    expect(icon.nativeElement.textContent.trim()).toBe('✈');
  });

  it('emits whyClicked when the (why?) button is clicked', () => {
    const f = TestBed.createComponent(HostComponent);
    f.detectChanges();
    const host = f.componentInstance;
    expect(host.whyCount).toBe(0);
    const whyBtn = f.debugElement.query(By.css('.tz-switch-row__why'));
    whyBtn.nativeElement.click();
    f.detectChanges();
    expect(host.whyCount).toBe(1);
  });
});
