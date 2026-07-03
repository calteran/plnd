/**
 * Map an Open-Meteo WMO weather interpretation code to a human-readable string.
 * Ported from the Rust `weather_code_to_condition` (plnd_data). See:
 * https://open-meteo.com/en/docs#weathervariables
 */
export function weatherCodeToCondition(code: number): string {
  if (code === 0) return 'Clear sky';
  if (code >= 1 && code <= 3) return 'Partly cloudy';
  if (code === 45 || code === 48) return 'Foggy';
  if (code >= 51 && code <= 67) return 'Rainy';
  if (code >= 71 && code <= 86) return 'Snowy';
  if (code >= 95 && code <= 99) return 'Thunderstorm';
  return 'Cloudy';
}
