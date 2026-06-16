import { zoneCity, zoneShort, zoneLong, offsetPhrase, offsetWords } from './zone-format';

describe('zone-format', () => {
  const d = new Date(Date.UTC(2026, 6, 15, 12, 0, 0)); // mid-July (summer)

  it('zoneCity derives an uppercase city from the IANA path', () => {
    expect(zoneCity('America/Denver')).toBe('DENVER');
    expect(zoneCity('America/Argentina/Buenos_Aires')).toBe('BUENOS AIRES');
  });

  it('zoneShort/zoneLong use Intl generic names for US zones', () => {
    expect(zoneShort('America/Denver', d)).toBe('MT');
    expect(zoneLong('America/Denver', d)).toBe('Mountain Time');
    expect(zoneShort('America/New_York', d)).toBe('ET');
  });

  it('zoneLong strips Standard/Daylight from zones that lack a distinct generic name', () => {
    // Pacific/Honolulu has no generic long name in CLDR, so ICU yields
    // "Hawaii-Aleutian Standard Time"; the token must be stripped.
    expect(zoneLong('Pacific/Honolulu', d)).toBe('Hawaii-Aleutian Time');
    // Zones with a true generic name are left unchanged.
    expect(zoneLong('America/Denver', d)).toBe('Mountain Time');
    expect(zoneLong('America/New_York', d)).toBe('Eastern Time');
  });

  it('offsetPhrase describes the day zone relative to the current zone', () => {
    expect(offsetPhrase('America/Denver', 'America/New_York', d)).toBe('2h behind your current zone');
    expect(offsetPhrase('America/New_York', 'America/Denver', d)).toBe('2h ahead of your current zone');
    expect(offsetPhrase('America/Denver', 'America/Denver', d)).toBe('same as your current zone');
  });

  it('offsetWords phrases a switch from one zone to another', () => {
    expect(offsetWords('America/Denver', 'Pacific/Honolulu', d)).toBe('4 hours earlier');
    expect(offsetWords('Pacific/Honolulu', 'America/Denver', d)).toBe('4 hours later');
  });
});
