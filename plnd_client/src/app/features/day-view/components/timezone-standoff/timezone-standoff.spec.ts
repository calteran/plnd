import { TestBed } from '@angular/core/testing';
import { Component, ChangeDetectionStrategy } from '@angular/core';
import { By } from '@angular/platform-browser';
import { TimezoneStandoffComponent } from './timezone-standoff';

@Component({
  standalone: true,
  imports: [TimezoneStandoffComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-timezone-standoff
      intendedZone="America/New_York"
      deviceZone="America/Denver"
      (moved)="movedCalled = true"
      (clockOff)="clockOffCalled = true"
    />
  `,
})
class HostComponent {
  movedCalled = false;
  clockOffCalled = false;
}

describe('TimezoneStandoffComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();
  });

  it('displays the intended zone as a friendly label containing "Eastern Time"', () => {
    const f = TestBed.createComponent(HostComponent);
    f.detectChanges();
    const msg = f.debugElement.query(By.css('.tz-standoff__msg'));
    expect(msg.nativeElement.textContent).toContain('Back in');
    expect(msg.nativeElement.textContent).toContain('Eastern Time');
  });

  it('emits moved when the "I moved here" button is clicked', () => {
    const f = TestBed.createComponent(HostComponent);
    f.detectChanges();
    const buttons = f.debugElement.queryAll(By.css('.tz-standoff__btn'));
    const movedBtn = buttons.find(b => b.nativeElement.textContent.trim() === 'I moved here')!;
    movedBtn.nativeElement.click();
    f.detectChanges();
    expect(f.componentInstance.movedCalled).toBe(true);
  });

  it('emits clockOff when the "Clock\'s off" button is clicked', () => {
    const f = TestBed.createComponent(HostComponent);
    f.detectChanges();
    const buttons = f.debugElement.queryAll(By.css('.tz-standoff__btn'));
    const clockOffBtn = buttons.find(b => b.nativeElement.textContent.trim() === "Clock's off")!;
    clockOffBtn.nativeElement.click();
    f.detectChanges();
    expect(f.componentInstance.clockOffCalled).toBe(true);
  });
});
