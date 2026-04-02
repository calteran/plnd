import { TestBed } from '@angular/core/testing';
import { ErrorHandler } from '@angular/core';
import { GlobalErrorHandlerService } from './error-handler.service';

describe('GlobalErrorHandlerService', () => {
  let handler: GlobalErrorHandlerService;
  let fetchSpy: jasmine.Spy;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: ErrorHandler, useClass: GlobalErrorHandlerService },
      ],
    });
    handler = TestBed.inject(ErrorHandler) as GlobalErrorHandlerService;

    // Spy on the global fetch so we can verify the POST without a real network
    fetchSpy = spyOn(window, 'fetch').and.returnValue(
      Promise.resolve(new Response(null, { status: 204 }))
    );
  });

  it('calls fetch with POST /api/client_error on handleError', () => {
    const err = new Error('test unhandled error');
    handler.handleError(err);
    expect(fetchSpy).toHaveBeenCalledOnceWith(
      '/api/client_error',
      jasmine.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });

  it('includes message and user_agent in the payload', () => {
    const err = new Error('boom');
    handler.handleError(err);
    const [, init] = fetchSpy.calls.first().args as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.message).toContain('boom');
    expect(body.user_agent).toBe(navigator.userAgent);
  });

  it('does not throw when called', () => {
    expect(() => handler.handleError(new Error('silent'))).not.toThrow();
  });
});
