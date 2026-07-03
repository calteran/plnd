import { weatherCodeToCondition } from './weather-code';

describe('weatherCodeToCondition', () => {
  it('maps clear, cloudy, fog, rain, snow, storm ranges', () => {
    expect(weatherCodeToCondition(0)).toBe('Clear sky');
    expect(weatherCodeToCondition(1)).toBe('Partly cloudy');
    expect(weatherCodeToCondition(3)).toBe('Partly cloudy');
    expect(weatherCodeToCondition(45)).toBe('Foggy');
    expect(weatherCodeToCondition(61)).toBe('Rainy');
    expect(weatherCodeToCondition(71)).toBe('Snowy');
    expect(weatherCodeToCondition(95)).toBe('Thunderstorm');
  });

  it('falls back to Cloudy for unknown codes', () => {
    expect(weatherCodeToCondition(200)).toBe('Cloudy');
  });
});
