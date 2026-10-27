import { toDays, fromDays, type Ymd } from './civil';

// Astronomy from Jean Meeus, "Astronomical Algorithms" (2nd ed.), chapters 27 and 49.
// Good to a few minutes for years 1000–3000, which is plenty to land on the right day.

const rad = Math.PI / 180;
const SYNODIC = 29.530588861;
const NEW_MOON_EPOCH = 2451550.09766; // 2000 Jan 6, k = 0

/** Julian Ephemeris Day of the k-th new moon after Jan 2000 */
function newMoon(k: number): number {
  const T = k / 1236.85;
  const E = 1 - 0.002516 * T - 0.0000074 * T * T;
  const M = (2.5534 + 29.1053567 * k - 0.0000014 * T * T) * rad;
  const Mp = (201.5643 + 385.81693528 * k + 0.0107582 * T * T + 0.00001238 * T ** 3) * rad;
  const F = (160.7108 + 390.67050284 * k - 0.0016118 * T * T - 0.00000227 * T ** 3) * rad;
  const O = (124.7746 - 1.56375588 * k + 0.0020672 * T * T) * rad;
  const jde = NEW_MOON_EPOCH + SYNODIC * k + 0.00015437 * T * T - 0.00000015 * T ** 3;
  const s = Math.sin;
  return (
    jde
    - 0.4072 * s(Mp) + 0.17241 * E * s(M) + 0.01608 * s(2 * Mp) + 0.01039 * s(2 * F)
    + 0.00739 * E * s(Mp - M) - 0.00514 * E * s(Mp + M) + 0.00208 * E * E * s(2 * M)
    - 0.00111 * s(Mp - 2 * F) - 0.00057 * s(Mp + 2 * F) + 0.00056 * E * s(2 * Mp + M)
    - 0.00042 * s(3 * Mp) + 0.00042 * E * s(M + 2 * F) + 0.00038 * E * s(M - 2 * F)
    - 0.00024 * E * s(2 * Mp - M) - 0.00017 * s(O) - 0.00007 * s(Mp + 2 * M)
    + 0.00004 * s(2 * Mp - 2 * F) + 0.00004 * s(3 * M) + 0.00003 * s(Mp + M - 2 * F)
    + 0.00003 * s(2 * Mp + 2 * F) - 0.00003 * s(Mp + M + 2 * F) + 0.00003 * s(Mp - M + 2 * F)
    - 0.00002 * s(Mp - M - 2 * F) - 0.00002 * s(3 * Mp + M) + 0.00002 * s(4 * Mp)
  );
}

/** mean December solstice; within about half an hour of the true one */
function decemberSolstice(year: number): number {
  const Y = (year - 2000) / 1000;
  return 2451900.05952 + 365242.74049 * Y - 0.06223 * Y * Y - 0.00823 * Y ** 3 + 0.00032 * Y ** 4;
}

/** the civil day (as a day number) in China, UTC+8, for a Julian Day */
const chinaDay = (jd: number) => Math.floor(jd + 8 / 24 - 2440587.5);

/**
 * Lunar New Year in a Gregorian year: the second new moon after the winter
 * solstice, as seen in China. In the rare winters with a leap 11th or 12th month
 * (next in 2033–34) it's the third, which the Jan 21–Feb 21 window catches.
 */
export function lunarNewYear(year: number): Ymd {
  const solsticeJd = decemberSolstice(year - 1);
  const solstice = chinaDay(solsticeJd);
  const moons: number[] = [];
  for (let k = Math.floor((solsticeJd - NEW_MOON_EPOCH) / SYNODIC) - 1; moons.length < 3; k++) {
    const day = chinaDay(newMoon(k));
    if (day > solstice) moons.push(day);
  }
  const first = toDays({ y: year, m: 1, d: 21 });
  const last = toDays({ y: year, m: 2, d: 21 });
  const fits = (d: number) => d >= first && d <= last;
  return fromDays(fits(moons[1]) ? moons[1] : (moons.find(fits) ?? moons[1]));
}

const ANIMALS = ['Rat', 'Ox', 'Tiger', 'Rabbit', 'Dragon', 'Snake', 'Horse', 'Goat', 'Monkey', 'Rooster', 'Dog', 'Pig'];
const ELEMENTS = ['Wood', 'Fire', 'Earth', 'Metal', 'Water'];

export interface ChineseSign {
  animal: string;
  element: string;
  /** Lunar New Year that started this sign's year */
  yearStart: Ymd;
}

/** Chinese zodiac for a birth date; Jan–Feb birthdays before Lunar New Year belong to the year before */
export function chineseZodiac(date: Ymd): ChineseSign {
  const ny = lunarNewYear(date.y);
  const year = toDays(date) < toDays(ny) ? date.y - 1 : date.y;
  const i = (((year - 4) % 60) + 60) % 60; // 4 CE began a sixty-year cycle (Wood Rat)
  return { animal: ANIMALS[i % 12], element: ELEMENTS[Math.floor((i % 10) / 2)], yearStart: year === date.y ? ny : lunarNewYear(year) };
}
