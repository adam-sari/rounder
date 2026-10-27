export type Lang = 'css' | 'js' | 'html';
export type Ecma = 5 | 2015 | 2020;

export interface MinifyOptions {
  /** CSS: let CSSO merge and move rules (smaller, still safe for valid CSS) */
  restructure: boolean;
  /** keep /*! license *\/ comments (CSS and JS) */
  keepLicense: boolean;
  /** JS */
  mangle: boolean;
  compress: boolean;
  module: boolean;
  ecma: Ecma;
  /** HTML */
  removeComments: boolean;
  collapseWhitespace: boolean;
  minifyCss: boolean;
  minifyJs: boolean;
}

export const defaultOptions: MinifyOptions = {
  restructure: true,
  keepLicense: true,
  mangle: true,
  compress: true,
  module: false,
  ecma: 2020,
  removeComments: true,
  collapseWhitespace: true,
  minifyCss: true,
  minifyJs: true,
};

/** Something worth pointing at in the input; line and column are 1-based */
export interface Note {
  message: string;
  line?: number;
  column?: number;
}

export interface MinifyResult {
  code: string;
  notes: Note[];
}

/** Thrown when the input can't be minified at all */
export class MinifyError extends Error {
  constructor(message: string, readonly line?: number, readonly column?: number) {
    super(message);
  }
}

/** "Line 3, column 7: message" */
export function describeNote(n: Note) {
  return n.line ? `Line ${n.line}${n.column ? `, column ${n.column}` : ''}: ${n.message}` : n.message;
}
