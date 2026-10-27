export interface Unit {
  id: string;
  name: string;
  plural: string;
  symbol: string;
  /** heading in the unit picker, e.g. "Metric" or "US customary" */
  group?: string;
  aliases?: string[];
  /** linear units: one of this unit in the category's base unit */
  factor: number;
  /** affine units (temperature): base = (value + offset) × factor */
  offset?: number;
  /** inverse units (L/100 km): base = factor ÷ value */
  inverse?: boolean;
}

export interface UnitCategory {
  id: string;
  name: string;
  units: Unit[];
  /** starting from/to pair */
  defaults: [string, string];
  /** values for the quick reference table */
  quick: number[];
}

const QUICK = [1, 2, 3, 4, 5, 10, 20, 25, 50, 100];

type Def = [id: string, name: string, plural: string, symbol: string, factor: number, aliases?: string[], extra?: Partial<Unit>];

function units(group: string | undefined, defs: Def[]): Unit[] {
  return defs.map(([id, name, plural, symbol, factor, aliases, extra]) => ({ id, name, plural, symbol, factor, group, aliases, ...extra }));
}

// Exact definitions where they exist: inch = 2.54 cm, lb = 0.45359237 kg, US gallon = 231 in³,
// imperial gallon = 4.54609 L, standard gravity = 9.80665 m/s², IT calorie-based BTU.
const LBF = 4.4482216152605; // pound-force in newtons (0.45359237 kg × 9.80665)
const BTU = 1055.05585262; // International Table BTU in joules
const MMHG = 133.322387415; // conventional mmHg in pascals

export const categories: UnitCategory[] = [
  {
    id: 'length',
    name: 'Length',
    defaults: ['m', 'ft'],
    quick: QUICK,
    units: [
      ...units('Metric', [
        ['nm', 'nanometer', 'nanometers', 'nm', 1e-9, ['nanometre']],
        ['um', 'micrometer', 'micrometers', 'µm', 1e-6, ['micron', 'micrometre', 'um']],
        ['mm', 'millimeter', 'millimeters', 'mm', 0.001, ['millimetre']],
        ['cm', 'centimeter', 'centimeters', 'cm', 0.01, ['centimetre']],
        ['m', 'meter', 'meters', 'm', 1, ['metre']],
        ['km', 'kilometer', 'kilometers', 'km', 1000, ['kilometre', 'kms']],
      ]),
      ...units('US & imperial', [
        ['in', 'inch', 'inches', 'in', 0.0254, ['"']],
        ['ft', 'foot', 'feet', 'ft', 0.3048, ["'"]],
        ['yd', 'yard', 'yards', 'yd', 0.9144],
        ['mi', 'mile', 'miles', 'mi', 1609.344],
        ['nmi', 'nautical mile', 'nautical miles', 'nmi', 1852, ['nm', 'nautical']],
      ]),
      ...units('Space', [
        ['au', 'astronomical unit', 'astronomical units', 'au', 149597870700],
        ['ly', 'light-year', 'light-years', 'ly', 9460730472580800, ['light year']],
      ]),
    ],
  },
  {
    id: 'weight',
    name: 'Weight',
    defaults: ['kg', 'lb'],
    quick: QUICK,
    units: [
      ...units('Metric', [
        ['ug', 'microgram', 'micrograms', 'µg', 1e-9, ['mcg', 'ug']],
        ['mg', 'milligram', 'milligrams', 'mg', 1e-6, ['milligramme']],
        ['g', 'gram', 'grams', 'g', 0.001, ['gramme']],
        ['kg', 'kilogram', 'kilograms', 'kg', 1, ['kilo', 'kilos', 'mass']],
        ['t', 'metric ton', 'metric tons', 't', 1000, ['tonne', 'tonnes']],
      ]),
      ...units('US & imperial', [
        ['gr', 'grain', 'grains', 'gr', 0.00006479891],
        ['oz', 'ounce', 'ounces', 'oz', 0.028349523125],
        ['lb', 'pound', 'pounds', 'lb', 0.45359237, ['lbs']],
        ['st', 'stone', 'stone', 'st', 6.35029318],
        ['ton-us', 'short ton (US)', 'short tons (US)', 'ton', 907.18474, ['us ton']],
        ['ton-uk', 'long ton (UK)', 'long tons (UK)', 'LT', 1016.0469088, ['uk ton', 'imperial ton']],
      ]),
      ...units('Precious', [
        ['ozt', 'troy ounce', 'troy ounces', 'oz t', 0.0311034768, ['gold', 'silver']],
        ['ct', 'carat', 'carats', 'ct', 0.0002, ['diamond']],
      ]),
    ],
  },
  {
    id: 'temperature',
    name: 'Temperature',
    defaults: ['c', 'f'],
    quick: [-40, -20, -10, 0, 10, 20, 25, 30, 37, 40, 50, 100],
    // base: kelvin
    units: units(undefined, [
      ['c', 'degree Celsius', 'degrees Celsius', '°C', 1, ['celsius', 'centigrade'], { offset: 273.15 }],
      ['f', 'degree Fahrenheit', 'degrees Fahrenheit', '°F', 5 / 9, ['fahrenheit'], { offset: 459.67 }],
      ['k', 'kelvin', 'kelvins', 'K', 1, ['kelvin']],
      ['r', 'degree Rankine', 'degrees Rankine', '°R', 5 / 9, ['rankine']],
    ]),
  },
  {
    id: 'volume',
    name: 'Volume',
    defaults: ['l', 'gal-us'],
    quick: QUICK,
    // base: liter
    units: [
      ...units('Metric', [
        ['ml', 'milliliter', 'milliliters', 'mL', 0.001, ['millilitre', 'cc']],
        ['cl', 'centiliter', 'centiliters', 'cL', 0.01, ['centilitre']],
        ['l', 'liter', 'liters', 'L', 1, ['litre', 'ltr']],
        ['cm3', 'cubic centimeter', 'cubic centimeters', 'cm³', 0.001, ['cc', 'cubic centimetre']],
        ['m3', 'cubic meter', 'cubic meters', 'm³', 1000, ['cubic metre']],
      ]),
      ...units('Metric cooking', [
        ['tsp-metric', 'teaspoon (metric)', 'teaspoons (metric)', 'tsp', 0.005],
        ['tbsp-metric', 'tablespoon (metric)', 'tablespoons (metric)', 'tbsp', 0.015],
        ['cup-metric', 'cup (metric)', 'cups (metric)', 'cup', 0.25],
      ]),
      ...units('US customary', [
        ['tsp-us', 'teaspoon (US)', 'teaspoons (US)', 'tsp', 0.00492892159375],
        ['tbsp-us', 'tablespoon (US)', 'tablespoons (US)', 'tbsp', 0.01478676478125, ['tbs']],
        ['floz-us', 'fluid ounce (US)', 'fluid ounces (US)', 'fl oz', 0.0295735295625, ['oz', 'ounce']],
        ['cup-us', 'cup (US)', 'cups (US)', 'cup', 0.2365882365],
        ['pt-us', 'pint (US)', 'pints (US)', 'pt', 0.473176473],
        ['qt-us', 'quart (US)', 'quarts (US)', 'qt', 0.946352946],
        ['gal-us', 'gallon (US)', 'gallons (US)', 'gal', 3.785411784],
        ['in3', 'cubic inch', 'cubic inches', 'in³', 0.016387064],
        ['ft3', 'cubic foot', 'cubic feet', 'ft³', 28.316846592],
      ]),
      ...units('Imperial (UK)', [
        ['floz-uk', 'fluid ounce (UK)', 'fluid ounces (UK)', 'fl oz', 0.0284130625, ['oz', 'ounce', 'imperial']],
        ['pt-uk', 'pint (UK)', 'pints (UK)', 'pt', 0.56826125, ['imperial']],
        ['qt-uk', 'quart (UK)', 'quarts (UK)', 'qt', 1.1365225, ['imperial']],
        ['gal-uk', 'gallon (UK)', 'gallons (UK)', 'gal', 4.54609, ['imperial']],
      ]),
    ],
  },
  {
    id: 'area',
    name: 'Area',
    defaults: ['m2', 'ft2'],
    quick: QUICK,
    units: [
      ...units('Metric', [
        ['mm2', 'square millimeter', 'square millimeters', 'mm²', 1e-6, ['sq mm']],
        ['cm2', 'square centimeter', 'square centimeters', 'cm²', 1e-4, ['sq cm']],
        ['m2', 'square meter', 'square meters', 'm²', 1, ['sq m', 'sqm', 'square metre']],
        ['ha', 'hectare', 'hectares', 'ha', 1e4],
        ['km2', 'square kilometer', 'square kilometers', 'km²', 1e6, ['sq km', 'square kilometre']],
      ]),
      ...units('US & imperial', [
        ['in2', 'square inch', 'square inches', 'in²', 0.00064516, ['sq in']],
        ['ft2', 'square foot', 'square feet', 'ft²', 0.09290304, ['sq ft', 'sqft']],
        ['yd2', 'square yard', 'square yards', 'yd²', 0.83612736, ['sq yd']],
        ['ac', 'acre', 'acres', 'ac', 4046.8564224],
        ['mi2', 'square mile', 'square miles', 'mi²', 2589988.110336, ['sq mi']],
      ]),
    ],
  },
  {
    id: 'speed',
    name: 'Speed',
    defaults: ['kmh', 'mph'],
    quick: [5, 10, 20, 30, 40, 50, 60, 70, 80, 100, 120],
    units: units(undefined, [
      ['mps', 'meter per second', 'meters per second', 'm/s', 1, ['metre per second']],
      ['kmh', 'kilometer per hour', 'kilometers per hour', 'km/h', 1000 / 3600, ['kph', 'kmph']],
      ['mph', 'mile per hour', 'miles per hour', 'mph', 0.44704],
      ['kn', 'knot', 'knots', 'kn', 1852 / 3600, ['kt', 'nautical']],
      ['fps', 'foot per second', 'feet per second', 'ft/s', 0.3048, ['fps']],
    ]),
  },
  {
    id: 'time',
    name: 'Time',
    defaults: ['h', 'min'],
    quick: QUICK,
    units: units(undefined, [
      ['ns', 'nanosecond', 'nanoseconds', 'ns', 1e-9],
      ['us', 'microsecond', 'microseconds', 'µs', 1e-6, ['us']],
      ['ms', 'millisecond', 'milliseconds', 'ms', 0.001],
      ['s', 'second', 'seconds', 's', 1, ['sec', 'secs']],
      ['min', 'minute', 'minutes', 'min', 60, ['mins']],
      ['h', 'hour', 'hours', 'h', 3600, ['hr', 'hrs']],
      ['d', 'day', 'days', 'd', 86400],
      ['wk', 'week', 'weeks', 'wk', 604800],
      // Gregorian calendar averages: 365.2425 days a year, a twelfth of that a month
      ['mo', 'month (average)', 'months (average)', 'mo', 2629746],
      ['yr', 'year (average)', 'years (average)', 'yr', 31556952, ['annum']],
    ]),
  },
  {
    id: 'data',
    name: 'Data size',
    defaults: ['gb', 'gib'],
    quick: [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1000, 1024],
    // base: byte
    units: [
      ...units('Bits', [
        ['bit', 'bit', 'bits', 'bit', 1 / 8],
        ['kbit', 'kilobit', 'kilobits', 'kbit', 125, ['kbps']],
        ['mbit', 'megabit', 'megabits', 'Mbit', 125e3, ['mbps']],
        ['gbit', 'gigabit', 'gigabits', 'Gbit', 125e6, ['gbps']],
      ]),
      ...units('Decimal (SI)', [
        ['byte', 'byte', 'bytes', 'B', 1],
        ['kb', 'kilobyte', 'kilobytes', 'KB', 1e3],
        ['mb', 'megabyte', 'megabytes', 'MB', 1e6],
        ['gb', 'gigabyte', 'gigabytes', 'GB', 1e9, ['gig']],
        ['tb', 'terabyte', 'terabytes', 'TB', 1e12],
        ['pb', 'petabyte', 'petabytes', 'PB', 1e15],
      ]),
      ...units('Binary (IEC)', [
        ['kib', 'kibibyte', 'kibibytes', 'KiB', 2 ** 10],
        ['mib', 'mebibyte', 'mebibytes', 'MiB', 2 ** 20],
        ['gib', 'gibibyte', 'gibibytes', 'GiB', 2 ** 30],
        ['tib', 'tebibyte', 'tebibytes', 'TiB', 2 ** 40],
        ['pib', 'pebibyte', 'pebibytes', 'PiB', 2 ** 50],
      ]),
    ],
  },
  {
    id: 'pressure',
    name: 'Pressure',
    defaults: ['bar', 'psi'],
    quick: QUICK,
    units: units(undefined, [
      ['pa', 'pascal', 'pascals', 'Pa', 1],
      ['hpa', 'hectopascal', 'hectopascals', 'hPa', 100],
      ['kpa', 'kilopascal', 'kilopascals', 'kPa', 1000],
      ['mpa', 'megapascal', 'megapascals', 'MPa', 1e6],
      ['mbar', 'millibar', 'millibars', 'mbar', 100, ['mb']],
      ['bar', 'bar', 'bar', 'bar', 1e5],
      ['psi', 'pound per square inch', 'pounds per square inch', 'psi', LBF / 0.00064516, ['lbf/in2']],
      ['atm', 'standard atmosphere', 'standard atmospheres', 'atm', 101325, ['atmosphere']],
      ['kgfcm2', 'kilogram-force per cm²', 'kilograms-force per cm²', 'kgf/cm²', 98066.5, ['kg/cm2', 'at']],
      ['mmhg', 'millimeter of mercury', 'millimeters of mercury', 'mmHg', MMHG, ['blood pressure']],
      ['inhg', 'inch of mercury', 'inches of mercury', 'inHg', MMHG * 25.4, ['barometer']],
      ['torr', 'torr', 'torr', 'Torr', 101325 / 760],
    ]),
  },
  {
    id: 'energy',
    name: 'Energy',
    defaults: ['kcal', 'kj'],
    quick: QUICK,
    units: units(undefined, [
      ['j', 'joule', 'joules', 'J', 1],
      ['kj', 'kilojoule', 'kilojoules', 'kJ', 1000],
      ['mj', 'megajoule', 'megajoules', 'MJ', 1e6],
      ['cal', 'calorie', 'calories', 'cal', 4.184, ['small calorie']],
      ['kcal', 'kilocalorie (food Calorie)', 'kilocalories (food Calories)', 'kcal', 4184, ['calorie', 'food']],
      ['wh', 'watt-hour', 'watt-hours', 'Wh', 3600, ['watt hour']],
      ['kwh', 'kilowatt-hour', 'kilowatt-hours', 'kWh', 3.6e6, ['kilowatt hour', 'electricity']],
      ['btu', 'British thermal unit', 'British thermal units', 'BTU', BTU],
      ['ftlbf', 'foot-pound', 'foot-pounds', 'ft·lbf', 0.3048 * LBF, ['ft lb', 'foot pound']],
      ['ev', 'electronvolt', 'electronvolts', 'eV', 1.602176634e-19, ['electron volt']],
    ]),
  },
  {
    id: 'power',
    name: 'Power',
    defaults: ['kw', 'hp'],
    quick: QUICK,
    units: units(undefined, [
      ['w', 'watt', 'watts', 'W', 1],
      ['kw', 'kilowatt', 'kilowatts', 'kW', 1000],
      ['mw', 'megawatt', 'megawatts', 'MW', 1e6],
      ['hp', 'horsepower (mechanical)', 'horsepower (mechanical)', 'hp', 550 * 0.3048 * LBF, ['bhp', 'imperial horsepower']],
      ['ps', 'horsepower (metric)', 'horsepower (metric)', 'PS', 75 * 9.80665, ['metric horsepower', 'cv', 'pk']],
      ['btuh', 'BTU per hour', 'BTU per hour', 'BTU/h', BTU / 3600, ['btu/hr', 'air conditioner']],
    ]),
  },
  {
    id: 'fuel',
    name: 'Fuel economy',
    defaults: ['mpg-us', 'l100km'],
    quick: [10, 15, 20, 25, 30, 35, 40, 50],
    // base: kilometers per liter. L/100 km runs the other way, so it's an inverse unit.
    units: units(undefined, [
      ['mpg-us', 'miles per gallon (US)', 'miles per gallon (US)', 'mpg', 1.609344 / 3.785411784, ['mpg us']],
      ['mpg-uk', 'miles per gallon (UK)', 'miles per gallon (UK)', 'mpg', 1.609344 / 4.54609, ['mpg uk', 'imperial']],
      ['kml', 'kilometers per liter', 'kilometers per liter', 'km/L', 1, ['kmpl']],
      ['l100km', 'liters per 100 km', 'liters per 100 km', 'L/100 km', 100, ['l/100km', 'consumption'], { inverse: true }],
    ]),
  },
  {
    id: 'angle',
    name: 'Angle',
    defaults: ['deg', 'rad'],
    quick: [1, 15, 30, 45, 60, 90, 120, 180, 270, 360],
    units: units(undefined, [
      ['deg', 'degree', 'degrees', '°', 1, ['deg']],
      ['rad', 'radian', 'radians', 'rad', 180 / Math.PI],
      ['grad', 'gradian', 'gradians', 'gon', 0.9, ['grad']],
      ['mrad', 'milliradian', 'milliradians', 'mrad', 0.18 / Math.PI, ['mil']],
      ['arcmin', 'arcminute', 'arcminutes', '′', 1 / 60, ['minute of arc', 'moa']],
      ['arcsec', 'arcsecond', 'arcseconds', '″', 1 / 3600, ['second of arc']],
      ['turn', 'turn', 'turns', 'turn', 360, ['revolution', 'rev']],
    ]),
  },
  {
    id: 'frequency',
    name: 'Frequency',
    defaults: ['hz', 'rpm'],
    quick: QUICK,
    units: units(undefined, [
      ['hz', 'hertz', 'hertz', 'Hz', 1, ['per second', 'cps']],
      ['khz', 'kilohertz', 'kilohertz', 'kHz', 1e3],
      ['mhz', 'megahertz', 'megahertz', 'MHz', 1e6],
      ['ghz', 'gigahertz', 'gigahertz', 'GHz', 1e9],
      ['rpm', 'revolution per minute', 'revolutions per minute', 'rpm', 1 / 60, ['bpm', 'per minute']],
    ]),
  },
];

export const categoryById: Record<string, UnitCategory> = Object.fromEntries(categories.map((c) => [c.id, c]));

export function findUnit(category: UnitCategory, id: string): Unit {
  const unit = category.units.find((u) => u.id === id);
  if (!unit) throw new Error(`Unknown unit "${id}" in ${category.id}`);
  return unit;
}
