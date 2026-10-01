export type Quality = 'low' | 'medium' | 'high';
export interface DisplaySettings {
  quality: Quality;
  fog: boolean;
  mist: boolean;
  bloom: boolean;
  dof: boolean;
  particles: boolean;
  reducedMotion: boolean;
  shake: boolean;
  flashes: boolean;
  mapCombat: boolean;
  timeOfDay: 'map' | 'day' | 'night';
  weather: 'clear' | 'rain' | 'snow';
}
export const qualityProfiles = {
  low: { dpr: 1, scale: .85, shadows: false, particles: 24 },
  medium: { dpr: 1.25, scale: 1, shadows: true, particles: 64 },
  high: { dpr: 1.5, scale: 1, shadows: true, particles: 120 },
} as const;
const key = 'embers-display-settings-v1';
export function readDisplaySettings(): DisplaySettings {
  const settings: DisplaySettings = { quality: 'medium', fog: true, mist: true, bloom: true, dof: false, particles: true,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, shake: true, flashes: true, mapCombat: true, timeOfDay: 'map', weather: 'clear' };
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? '{}');
    for (const name of Object.keys(settings) as (keyof DisplaySettings)[]) if (typeof settings[name] === 'boolean' && typeof value[name] === 'boolean') Object.assign(settings, { [name]: value[name] });
    if (['low', 'medium', 'high'].includes(value.quality)) settings.quality = value.quality;
    if (['map', 'day', 'night'].includes(value.timeOfDay)) settings.timeOfDay = value.timeOfDay;
    if (['clear', 'rain', 'snow'].includes(value.weather)) settings.weather = value.weather;
  } catch { /* Private browsing may disable persistent display preferences. */ }
  settings.mapCombat = true;
  return settings;
}
export function saveDisplaySettings(settings: DisplaySettings) { try { localStorage.setItem(key, JSON.stringify(settings)); } catch { /* Session settings still work. */ } }
