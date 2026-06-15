import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TimezoneService } from './timezone.service';
import { ConfigService } from './config.service';
import { EnvironmentConfig } from '../models/config';

describe('TimezoneService', () => {
  let service: TimezoneService;
  let httpMock: HttpTestingController;
  const apiBase = 'http://api.test';

  const mockConfig: EnvironmentConfig = {
    production: false,
    api: { baseUrl: apiBase, timeout: 30000 },
    database: { url: '' },
    logging: { level: 'error', prettyPrint: false },
    oidc: {
      issuerUrl: '',
      clientId: '',
      redirectUri: '',
      scope: '',
      strictDiscoveryDocumentValidation: false,
    },
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(), TimezoneService,
        { provide: ConfigService, useValue: { getConfig: () => mockConfig } },
      ],
    });
    service = TestBed.inject(TimezoneService);
    httpMock = TestBed.inject(HttpTestingController);
  });
  afterEach(() => httpMock.verify());

  it('reportDeviceZone POSTs the device IANA zone', () => {
    let res: unknown;
    service.reportDeviceZone('America/Denver').subscribe(r => (res = r));
    const req = httpMock.expectOne(`${apiBase}/timezone/device`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ zone: 'America/Denver' });
    req.flush({ outcome: 'no_change', effective_zone: 'America/Denver', confirm: null });
    expect(res).toEqual({ outcome: 'no_change', effective_zone: 'America/Denver', confirm: null });
  });

  it('listAnchors GETs anchors through a date', () => {
    service.listAnchors('2026-07-01').subscribe();
    const req = httpMock.expectOne(`${apiBase}/timezone/anchors?through=2026-07-01`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('deleteGroup DELETEs the inference group', () => {
    service.deleteGroup('grp-1').subscribe();
    const req = httpMock.expectOne(`${apiBase}/timezone/anchors/group/grp-1`);
    expect(req.request.method).toBe('DELETE');
    req.flush({ deleted: 2 });
  });

  it('dismissStandoff POSTs to the dismiss endpoint', () => {
    service.dismissStandoff().subscribe();
    const req = httpMock.expectOne(`${apiBase}/timezone/standoff/dismiss`);
    expect(req.request.method).toBe('POST');
    req.flush(null);
  });

  it('deviceZone returns the Intl resolved IANA zone', () => {
    expect(service.deviceZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
});
