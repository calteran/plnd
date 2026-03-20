import { TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { Router } from '@angular/router';
import { SettingsComponent } from './settings';

describe('SettingsComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SettingsComponent, RouterTestingModule]
    }).compileComponents();
  });

  it('should create', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders immediately with no loading guard', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1').textContent).toContain('Settings');
    expect(fixture.nativeElement.querySelector('.loading-text')).toBeNull();
  });

  it('goBack() navigates to /dashboard', () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();
    const router = TestBed.inject(Router);
    spyOn(router, 'navigate');
    fixture.componentInstance.goBack();
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
  });
});
