import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Component, signal } from '@angular/core';
import { ReorderControlsComponent } from './reorder-controls';

@Component({
  standalone: true,
  imports: [ReorderControlsComponent],
  template: `<app-reorder-controls
    [label]="'Take meds'" [canUp]="canUp()" [canDown]="canDown()"
    [canPrevDay]="canPrevDay()" [canNextDay]="canNextDay()"
    (up)="ups = ups + 1" (down)="downs = downs + 1"
    (prevDay)="prevs = prevs + 1" (nextDay)="nexts = nexts + 1" />`,
})
class HostComponent {
  canUp = signal(true);
  canDown = signal(true);
  canPrevDay = signal<boolean | undefined>(undefined);
  canNextDay = signal<boolean | undefined>(undefined);
  ups = 0; downs = 0; prevs = 0; nexts = 0;
}

function setup() {
  TestBed.configureTestingModule({ imports: [HostComponent] });
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  return fixture;
}

describe('ReorderControlsComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('renders up/down but NOT day-jump buttons when canPrevDay/canNextDay are undefined', () => {
    const fixture = setup();
    expect(fixture.debugElement.query(By.css('[data-testid="reorder-up"]'))).toBeTruthy();
    expect(fixture.debugElement.query(By.css('[data-testid="reorder-down"]'))).toBeTruthy();
    expect(fixture.debugElement.query(By.css('[data-testid="reorder-prev-day"]'))).toBeNull();
    expect(fixture.debugElement.query(By.css('[data-testid="reorder-next-day"]'))).toBeNull();
  });

  it('renders day-jump buttons when the can*Day inputs are defined', () => {
    const fixture = setup();
    fixture.componentInstance.canPrevDay.set(false);
    fixture.componentInstance.canNextDay.set(true);
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('[data-testid="reorder-prev-day"]'))).toBeTruthy();
    expect(fixture.debugElement.query(By.css('[data-testid="reorder-next-day"]'))).toBeTruthy();
  });

  it('disables a direction when its can flag is false', () => {
    const fixture = setup();
    fixture.componentInstance.canUp.set(false);
    fixture.detectChanges();
    const up = fixture.debugElement.query(By.css('[data-testid="reorder-up"]')).nativeElement as HTMLButtonElement;
    expect(up.disabled).toBe(true);
  });

  it('emits up/down on click', () => {
    const fixture = setup();
    fixture.debugElement.query(By.css('[data-testid="reorder-up"]')).nativeElement.click();
    fixture.debugElement.query(By.css('[data-testid="reorder-down"]')).nativeElement.click();
    expect(fixture.componentInstance.ups).toBe(1);
    expect(fixture.componentInstance.downs).toBe(1);
  });

  it('gives each button an aria-label naming the task and action', () => {
    const fixture = setup();
    const up = fixture.debugElement.query(By.css('[data-testid="reorder-up"]')).nativeElement as HTMLButtonElement;
    expect(up.getAttribute('aria-label')).toBe('Move Take meds earlier');
  });
});
