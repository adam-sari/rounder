import { describe, expect, it } from 'vitest';
import { add, gpa, gradePoints, parseSaved, previousTotals, totals, type Course } from '@/tools/lib/gpa/gpa';

const c = (grade: Course['grade'], credits: number | null, level: Course['level'] = 'regular'): Course => ({ name: '', grade, credits, level });

describe('gradePoints', () => {
  it('follows the common 4.0 scale', () => {
    expect(gradePoints('A')).toBe(4);
    expect(gradePoints('B+')).toBe(3.3);
    expect(gradePoints('C-')).toBe(1.7);
    expect(gradePoints('F')).toBe(0);
  });

  it('lets A+ count as 4.0 or 4.3', () => {
    expect(gradePoints('A+')).toBe(4);
    expect(gradePoints('A+', 4.3)).toBe(4.3);
  });
});

describe('totals and gpa', () => {
  it('weights grades by credits', () => {
    // (4×4 + 3×3) / 7
    const g = gpa(totals([c('A', 4), c('B', 3)]))!;
    expect(g.unweighted).toBeCloseTo(25 / 7, 10);
  });

  it('adds the honors and AP bonus to the weighted GPA only', () => {
    const g = gpa(totals([c('A', 1, 'ap'), c('B', 1, 'honors'), c('C', 1)]))!;
    expect(g.unweighted).toBeCloseTo(3, 10);
    expect(g.weighted).toBeCloseTo((5 + 3.5 + 2) / 3, 10);
  });

  it('never adds a bonus to an F', () => {
    const g = gpa(totals([c('F', 1, 'ap')]))!;
    expect(g.weighted).toBe(0);
  });

  it('skips courses without a grade or credits', () => {
    expect(totals([c('', 3), c('A', null), c('A', 0)]).credits).toBe(0);
    expect(gpa(totals([]))).toBeNull();
  });

  it('combines with a previous cumulative GPA', () => {
    // 3.0 over 30 credits, then a 4.0 over 15 credits
    const g = gpa(add(previousTotals(3, 30), totals([c('A', 15)])))!;
    expect(g.unweighted).toBeCloseTo(10 / 3, 10);
    expect(previousTotals(null, 30).credits).toBe(0);
  });
});

describe('parseSaved', () => {
  it('restores valid data and drops anything odd', () => {
    const saved = parseSaved(JSON.stringify({
      aPlus: 4.3,
      prevGpa: 3.2,
      prevCredits: 'x',
      semesters: [{ name: 'Fall', courses: [{ name: 'Bio', credits: 4, grade: 'Z', level: 'nope' }] }],
    }))!;
    expect(saved.aPlus).toBe(4.3);
    expect(saved.prevGpa).toBe(3.2);
    expect(saved.prevCredits).toBeNull();
    expect(saved.semesters[0].courses[0]).toEqual({ name: 'Bio', credits: 4, grade: '', level: 'regular' });
  });

  it('returns null for empty or broken data', () => {
    expect(parseSaved(null)).toBeNull();
    expect(parseSaved('{oops')).toBeNull();
  });
});
