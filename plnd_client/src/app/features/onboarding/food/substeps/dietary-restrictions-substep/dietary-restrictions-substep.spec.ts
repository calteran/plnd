import { createSpyObj, type SpyObj } from '../../../../../../testing/spy';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { DietaryRestrictionsSubstepComponent } from './dietary-restrictions-substep';
import { DietaryRestrictionsService } from '../../../../../core/services/dietary-restrictions.service';
import { of } from 'rxjs';

describe('DietaryRestrictionsSubstepComponent', () => {
  let component: DietaryRestrictionsSubstepComponent;
  let fixture: ComponentFixture<DietaryRestrictionsSubstepComponent>;
  let restrictionsSvc: SpyObj<DietaryRestrictionsService>;

  beforeEach(async () => {
    restrictionsSvc = createSpyObj(['load', 'create', 'update', 'delete'], {
      restrictions: vi.fn().mockReturnValue([]),
    });

    await TestBed.configureTestingModule({
      imports: [DietaryRestrictionsSubstepComponent],
      providers: [
        { provide: DietaryRestrictionsService, useValue: restrictionsSvc },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DietaryRestrictionsSubstepComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders banner and type selector with three type buttons', () => {
    const banner = fixture.nativeElement.querySelector('.banner');
    expect(banner.textContent).toContain('should never appear');
    const typeBtns = fixture.nativeElement.querySelectorAll('.type-btn');
    expect(typeBtns.length).toBe(3);
  });

  it('adds an allergy restriction via the service', fakeAsync(() => {
    restrictionsSvc.create.mockReturnValue(of({
      restriction_id: 'r1', user_id: 'u1', restriction_type: 'allergy',
      name: 'Peanuts', notes: null, created_at: '', updated_at: '',
    }));

    component.newName.set('Peanuts');
    component.selectedDisplayType.set('allergy');
    component.add();
    tick();

    expect(restrictionsSvc.create).toHaveBeenCalledWith({
      restriction_type: 'allergy',
      name: 'Peanuts',
    });
  }));

  it('sends cultural_religious type directly to the API', fakeAsync(() => {
    restrictionsSvc.create.mockReturnValue(of({
      restriction_id: 'r2', user_id: 'u1', restriction_type: 'cultural_religious',
      name: 'Pork', notes: null, created_at: '', updated_at: '',
    }));
    component.newName.set('Pork');
    component.selectedDisplayType.set('cultural_religious');
    component.add();
    tick();
    expect(restrictionsSvc.create).toHaveBeenCalledWith({
      restriction_type: 'cultural_religious',
      name: 'Pork',
    });
  }));

  it('save() emits complete immediately', () => {
    let completed = false;
    component.complete.subscribe(() => completed = true);
    component.save();
    expect(completed).toBe(true);
  });

  it('add() does not call create() when newName is empty', () => {
    component.newName.set('');
    component.add();
    expect(restrictionsSvc.create).not.toHaveBeenCalled();
  });

  it('displayTypeFor() maps API types to display types correctly', () => {
    expect(component.displayTypeFor('allergy')).toBe('allergy');
    expect(component.displayTypeFor('intolerance')).toBe('intolerance');
    expect(component.displayTypeFor('cultural_religious')).toBe('cultural_religious');
    expect(component.displayTypeFor('preference')).toBe('cultural_religious'); // legacy data
  });
});
