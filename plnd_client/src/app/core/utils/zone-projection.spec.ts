import { classifyDay } from './zone-projection';
import { TimezoneAnchorDto } from '../models/timezone';

function anchor(date: string, zone: string, time: string | null = null, extra: Partial<TimezoneAnchorDto> = {}): TimezoneAnchorDto {
  return { id: `${date}-${zone}`, user_id: 'u', effective_date: date, effective_time: time, zone,
           source: 'user', source_ref: null, inference_group: null, created_at: '', updated_at: '', ...extra };
}

describe('classifyDay', () => {
  it('same-zone day → kind "same"', () => {
    const v = classifyDay([anchor('2026-01-01', 'America/New_York')], '2026-07-10', 'America/New_York');
    expect(v.kind).toBe('same');
  });

  it('full divergent day → kind "divergent" with incoming zone', () => {
    const anchors = [anchor('2026-01-01', 'America/New_York'), anchor('2026-07-01', 'America/Denver')];
    const v = classifyDay(anchors, '2026-07-10', 'America/New_York');
    expect(v.kind).toBe('divergent');
    expect(v.incomingZone).toBe('America/Denver');
  });

  it('travel day (intra-day anchor) → kind "travel" with switch zones', () => {
    const anchors = [anchor('2026-01-01', 'America/Denver'), anchor('2026-07-10', 'Pacific/Honolulu', '14:00:00')];
    const v = classifyDay(anchors, '2026-07-10', 'America/Denver');
    expect(v.kind).toBe('travel');
    expect(v.switch?.fromZone).toBe('America/Denver');
    expect(v.switch?.toZone).toBe('Pacific/Honolulu');
  });

  it('no anchors at all → "same" (falls back to currentZone)', () => {
    const v = classifyDay([], '2026-07-10', 'America/Denver');
    expect(v.kind).toBe('same');
    expect(v.incomingZone).toBeNull();
  });
});
