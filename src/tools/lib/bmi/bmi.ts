export const CM_PER_INCH = 2.54;
export const KG_PER_LB = 0.45359237;

export function bmi(kg: number, cm: number) {
  if (!(kg > 0) || !(cm > 0)) return null;
  const m = cm / 100;
  return kg / (m * m);
}

export interface BmiClass {
  id: 'under' | 'healthy' | 'over' | 'obese1' | 'obese2' | 'obese3';
  label: string;
  /** lower bound, inclusive */
  from: number;
}

/** WHO adult cut-offs */
export const CLASSES: BmiClass[] = [
  { id: 'under', label: 'Underweight', from: 0 },
  { id: 'healthy', label: 'Healthy weight', from: 18.5 },
  { id: 'over', label: 'Overweight', from: 25 },
  { id: 'obese1', label: 'Obesity class 1', from: 30 },
  { id: 'obese2', label: 'Obesity class 2', from: 35 },
  { id: 'obese3', label: 'Obesity class 3', from: 40 },
];

/** Classifies on the value shown to one decimal, so 24.96 (shown as 25.0) reads as overweight */
export function classify(value: number): BmiClass {
  const shown = Math.round(value * 10) / 10;
  return CLASSES.findLast((c) => shown >= c.from)!;
}

/** Weights (kg) that give a BMI of 18.5 to 24.9 at this height */
export function healthyRange(cm: number): [number, number] | null {
  if (!(cm > 0)) return null;
  const m2 = (cm / 100) ** 2;
  return [18.5 * m2, 24.9 * m2];
}

export const toCm = (feet: number, inches: number) => ((feet || 0) * 12 + (inches || 0)) * CM_PER_INCH;
export const toKg = (lb: number) => lb * KG_PER_LB;
export const toLb = (kg: number) => kg / KG_PER_LB;

/** 180 cm → { feet: 5, inches: 10.9 } (inches to one decimal, never 12) */
export function toFeetInches(cm: number) {
  const total = Math.round((cm / CM_PER_INCH) * 10) / 10;
  const feet = Math.floor(total / 12);
  return { feet, inches: Math.round((total - feet * 12) * 10) / 10 };
}
