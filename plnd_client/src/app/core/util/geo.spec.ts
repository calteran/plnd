import { roundCoord, coordStr, locationKey } from './geo';

describe('geo', () => {
  it('rounds coordinates to one decimal place', () => {
    expect(roundCoord(51.5074)).toBe(51.5);
    expect(roundCoord(45.58)).toBe(45.6);
    expect(roundCoord(-122.68)).toBe(-122.7);
  });

  it('formats a coordinate string at one decimal place', () => {
    expect(coordStr(-0.1278)).toBe('-0.1');
    expect(coordStr(45)).toBe('45.0');
  });

  it('builds a location key from lat/lon', () => {
    expect(locationKey(51.5074, -0.1278)).toBe('51.5,-0.1');
  });
});
