import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { AddEntryComponent } from './add-entry';

describe('AddEntryComponent', () => {
  async function setup() {
    await TestBed.configureTestingModule({ imports: [AddEntryComponent] }).compileComponents();
    const f = TestBed.createComponent(AddEntryComponent);
    f.detectChanges();
    return f;
  }

  it('shows the add row when closed', async () => {
    const f = await setup();
    expect(f.nativeElement.textContent).toContain('Add something');
    expect(f.debugElement.query(By.css('.entry-panel'))).toBeNull();
  });

  it('opens the entry panel when add row is clicked', async () => {
    const f = await setup();
    f.debugElement.query(By.css('.add-row')).nativeElement.click();
    f.detectChanges();
    expect(f.debugElement.query(By.css('.entry-panel'))).toBeTruthy();
  });

  it('shows appointment fields when text contains a time pattern', async () => {
    const f = await setup();
    f.debugElement.query(By.css('.add-row')).nativeElement.click();
    f.detectChanges();
    const input = f.debugElement.query(By.css('.entry-input')).nativeElement as HTMLInputElement;
    input.value = 'dentist 2pm';
    input.dispatchEvent(new Event('input'));
    f.detectChanges();
    expect(f.debugElement.query(By.css('.morph-form--appointment'))).toBeTruthy();
  });

  it('shows exercise fields when text contains an exercise keyword', async () => {
    const f = await setup();
    f.debugElement.query(By.css('.add-row')).nativeElement.click();
    f.detectChanges();
    const input = f.debugElement.query(By.css('.entry-input')).nativeElement as HTMLInputElement;
    input.value = 'run 30 min';
    input.dispatchEvent(new Event('input'));
    f.detectChanges();
    expect(f.debugElement.query(By.css('.morph-form--exercise'))).toBeTruthy();
  });

  it('closes the panel on Escape', async () => {
    const f = await setup();
    f.debugElement.query(By.css('.add-row')).nativeElement.click();
    f.detectChanges();
    const input = f.debugElement.query(By.css('.entry-input')).nativeElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    f.detectChanges();
    expect(f.debugElement.query(By.css('.entry-panel'))).toBeNull();
  });
});
