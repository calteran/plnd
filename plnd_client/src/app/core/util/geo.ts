/** Round a coordinate to 1 decimal place (~11 km grid). Mirrors the server's
 *  former `round_location`: a privacy jitter (precise GPS never leaves the
 *  browser) and a cache-key normalizer in one. */
export const roundCoord = (n: number): number => Math.round(n * 10) / 10;

/** Rounded coordinate as a fixed 1-dp string, for URLs and keys. */
export const coordStr = (n: number): string => roundCoord(n).toFixed(1);

/** Stable cache key / `loc` param for a rounded lat/lon pair. */
export const locationKey = (lat: number, lon: number): string =>
  `${coordStr(lat)},${coordStr(lon)}`;
