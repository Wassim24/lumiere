// Display color helpers (from the design's prototype logic).
const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

export function kelvinRgb(k: number): number {
  const t = k / 100;
  let r: number, g: number, b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  }
  if (t >= 66) b = 255;
  else if (t <= 19) b = 0;
  else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return (clamp(r) << 16) | (clamp(g) << 8) | clamp(b);
}

/** h in degrees, s and v in 0..1 */
export function hsvRgb(h: number, s: number, v = 1): number {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  return (clamp((r + m) * 255) << 16) | (clamp((g + m) * 255) << 8) | clamp((b + m) * 255);
}

export function rgbHs(rgb: number): { hue: number; sat: number } {
  const r = ((rgb >> 16) & 255) / 255, g = ((rgb >> 8) & 255) / 255, b = (rgb & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return { hue: h, sat: max ? d / max : 0 };
}

const ORB_BLUR = 70; // CSS blur(70px)
export const orbReach = (r: number) => r + 2.5 * ORB_BLUR;
const orbCache = new Map<number, { offset: number; alpha: number }[]>();

/** Gradient stops matching a solid disk of radius r under a gaussian blur. */
export function orbStops(r: number) {
  const cached = orbCache.get(r);
  if (cached) return cached;
  const N = 12, RINGS = 24, ANGLES = 24, s2 = 2 * ORB_BLUR * ORB_BLUR;
  const stops = Array.from({ length: N + 1 }, (_, i) => {
    const d = (i / N) * orbReach(r);
    let sum = 0;
    for (let a = 0; a < RINGS; a++) {
      const s = ((a + 0.5) / RINGS) * r;
      for (let b = 0; b < ANGLES; b++) {
        const c = Math.cos(((b + 0.5) / ANGLES) * Math.PI);
        sum += s * Math.exp(-(d * d + s * s - 2 * d * s * c) / s2);
      }
    }
    return { offset: i / N, alpha: i === N ? 0 : (2 * r * sum) / (RINGS * ANGLES * s2) };
  });
  orbCache.set(r, stops);
  return stops;
}

export const hex = (rgb: number) => '#' + (rgb & 0xffffff).toString(16).padStart(6, '0').toUpperCase();
export const parseHex = (h: string) => parseInt(h.replace('#', ''), 16);
