export const GRADES = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F'] as const;
export type Grade = (typeof GRADES)[number];

const POINTS: Record<Grade, number> = {
  'A+': 4, A: 4, 'A-': 3.7, 'B+': 3.3, B: 3, 'B-': 2.7, 'C+': 2.3, C: 2, 'C-': 1.7, 'D+': 1.3, D: 1, 'D-': 0.7, F: 0,
};

export type APlus = 4 | 4.3;

export function gradePoints(grade: Grade, aPlus: APlus = 4) {
  return grade === 'A+' ? aPlus : POINTS[grade];
}

export type Level = 'regular' | 'honors' | 'ap';
export const LEVELS: [Level, string, number][] = [
  ['regular', 'Regular', 0],
  ['honors', 'Honors', 0.5],
  ['ap', 'AP / IB', 1],
];
const BONUS = Object.fromEntries(LEVELS.map(([id, , bonus]) => [id, bonus])) as Record<Level, number>;

export interface Course {
  name: string;
  credits: number | null;
  /** empty while a grade isn't known yet; the course is left out until then */
  grade: Grade | '';
  level: Level;
}

export interface Semester {
  name: string;
  courses: Course[];
}

export interface Totals {
  credits: number;
  points: number;
  weightedPoints: number;
}

export const NO_TOTALS: Totals = { credits: 0, points: 0, weightedPoints: 0 };

/** Credit-weighted grade points; the honors/AP bonus is never added to an F */
export function totals(courses: Course[], aPlus: APlus = 4): Totals {
  let credits = 0;
  let points = 0;
  let weightedPoints = 0;
  for (const c of courses) {
    if (!c.grade || !(c.credits! > 0)) continue;
    const p = gradePoints(c.grade, aPlus);
    credits += c.credits!;
    points += p * c.credits!;
    weightedPoints += (c.grade === 'F' ? 0 : p + BONUS[c.level]) * c.credits!;
  }
  return { credits, points, weightedPoints };
}

export function add(a: Totals, b: Totals): Totals {
  return { credits: a.credits + b.credits, points: a.points + b.points, weightedPoints: a.weightedPoints + b.weightedPoints };
}

/** A GPA and credits from before, as totals (the same GPA counts for weighted and unweighted) */
export function previousTotals(gpa: number | null, credits: number | null): Totals {
  if (gpa == null || !(gpa >= 0) || credits == null || !(credits > 0)) return NO_TOTALS;
  return { credits, points: gpa * credits, weightedPoints: gpa * credits };
}

export const gpa = (t: Totals) => (t.credits > 0 ? { unweighted: t.points / t.credits, weighted: t.weightedPoints / t.credits } : null);

const isGrade = (g: unknown): g is Grade => GRADES.includes(g as Grade);

/** Rebuilds saved data defensively; anything unexpected is dropped */
export function parseSaved(raw: string | null): { aPlus: APlus; prevGpa: number | null; prevCredits: number | null; semesters: Semester[] } | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw);
    const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
    const semesters = (Array.isArray(d.semesters) ? d.semesters : []).map((s: Partial<Semester>) => ({
      name: typeof s?.name === 'string' ? s.name : '',
      courses: (Array.isArray(s?.courses) ? s.courses : []).map((c: Partial<Course>) => ({
        name: typeof c?.name === 'string' ? c.name : '',
        credits: num(c?.credits),
        grade: isGrade(c?.grade) ? c.grade : '',
        level: LEVELS.some(([id]) => id === c?.level) ? c.level! : 'regular',
      })),
    }));
    return { aPlus: d.aPlus === 4.3 ? 4.3 : 4, prevGpa: num(d.prevGpa), prevCredits: num(d.prevCredits), semesters };
  } catch {
    return null;
  }
}
