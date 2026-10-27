import { convert, prettyNumber } from '../lib/units/convert';
import { categoryById, findUnit } from '../lib/units/units';
import { privacyFaq, type Faq, type Tool } from '../types';

type Copy = Pick<Tool, 'slug' | 'name' | 'h1' | 'title' | 'description' | 'tagline' | 'keywords' | 'steps' | 'faq' | 'related'>;

/** "1 cm = 0.393701 in, 10 cm = 3.93701 in and 100 cm = 39.3701 in", computed so the copy can't drift from the math */
function examples(category: string, from: string, to: string, values: number[]): string {
  const c = categoryById[category];
  const [a, b] = [findUnit(c, from), findUnit(c, to)];
  const parts = values.map((v) => `${prettyNumber(v, 15)} ${a.symbol} = ${prettyNumber(convert(v, a, b), 6)} ${b.symbol}`);
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}.`;
}

/** a /x-to-y page that opens the converter preset to that pair, with its own reference table */
function variant(category: string, from: string, to: string, table: number[], examplesQ: Faq['q'], copy: Copy): Tool {
  return {
    category: 'everyday',
    island: 'UnitConverter',
    props: { category, from, to, table },
    variantOf: 'unit-converter',
    ...copy,
    faq: [{ q: examplesQ, a: examples(category, from, to, table.filter((_, i) => i % 3 === 0)) }, ...copy.faq, privacyFaq],
  };
}

export default [
  {
    slug: 'unit-converter',
    category: 'everyday',
    name: 'Unit converter',
    title: 'Unit Converter: length, weight, temperature, volume & more',
    h1: 'Unit *converter*',
    description: 'Convert length, weight, temperature, volume, area, speed, data size, pressure, energy, fuel economy and more, with exact factors and live results.',
    tagline: 'Fourteen kinds of units, exact factors, and answers as you type.',
    keywords: ['unit conversion', 'metric to imperial', 'measurement converter', 'cups to ml', 'mpg to l/100km', 'mb to mib', 'psi to bar', 'convert units online'],
    island: 'UnitConverter',
    steps: [
      'Pick what you are converting: length, weight, temperature, volume or one of ten more.',
      'Type a number on either side and choose the units. The search box finds any unit, even in another category.',
      'Read the answer, copy it, or scan the table showing your value in every unit at once.',
    ],
    faq: [
      { q: 'How accurate are the conversions?', a: 'Factors use the exact definitions wherever they exist: an inch is exactly 2.54 cm, a pound exactly 0.45359237 kg and a US gallon exactly 231 cubic inches. Answers are rounded to the significant digits you choose (up to 15), and a "≈" sign tells you when what you see is rounded.' },
      { q: 'What is the difference between MB and MiB?', a: 'A megabyte (MB) is 1,000,000 bytes, while a mebibyte (MiB) is 1,048,576 bytes (2²⁰). Drive makers use the decimal units, but Windows counts in binary units and labels them "GB", which is why a 1 TB drive shows up as about 931 GB.' },
      { q: 'Why do US and UK cups, pints and gallons differ?', a: 'The two systems defined them separately. A US gallon is 3.785 liters and an imperial (UK) gallon 4.546 liters, and a US pint holds 16 fluid ounces while a UK pint holds 20 (slightly smaller) ones. Many recipes outside the US use a metric cup of 250 mL, so all three cups are in the list.' },
      { q: 'Why does L/100 km go down when mpg goes up?', a: 'Miles per gallon measures distance per unit of fuel, while liters per 100 km measures fuel per unit of distance, so one is the inverse of the other. To get L/100 km, divide 235.215 by US mpg, or 282.481 by UK mpg.' },
      privacyFaq,
    ],
    related: ['currency-converter', 'percentage-calculator', 'date-calculator'],
  },

  variant('length', 'cm', 'in', [1, 2, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100], 'What are some common cm to inch conversions?', {
    slug: 'cm-to-inches',
    name: 'CM to inches',
    h1: 'CM to *inches*',
    title: 'CM to Inches Converter: centimeters to inches, with table',
    description: 'Convert centimeters to inches instantly, with a cm to inches chart. 1 cm = 0.3937 inches, since an inch is exactly 2.54 cm. Free, works offline.',
    tagline: 'Centimeters to inches, both ways, with a ready-made chart.',
    keywords: ['cm to inches', 'centimeters to inches', 'cm to in', 'convert cm to inches', 'cm to inches chart', 'inches to cm', 'how many inches in a cm', 'cm to feet and inches'],
    steps: [
      'Type the length in centimeters. Fractions like 1/2 work too.',
      'The inches appear as you type. Type in the inches box to go the other way.',
      'Use the chart below for common sizes, or switch units to feet, millimeters and more.',
    ],
    faq: [
      { q: 'How do I convert cm to inches?', a: 'Divide by 2.54, because one inch is defined as exactly 2.54 centimeters. For a quick estimate, multiply by 0.4: it comes out slightly high, by about 1.6%.' },
      { q: 'How do I get feet and inches from centimeters?', a: 'Convert to inches first, then take out 12 inches for each foot. For example, 170 cm is 66.93 inches, which is 5 feet and 6.93 inches.' },
    ],
    related: ['feet-to-meters', 'km-to-miles', 'unit-converter'],
  }),

  variant('weight', 'kg', 'lb', [1, 2, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 'What are some common kg to lbs conversions?', {
    slug: 'kg-to-lbs',
    name: 'KG to lbs',
    h1: 'KG to *lbs*',
    title: 'KG to LBS Converter: kilograms to pounds, with chart',
    description: 'Convert kilograms to pounds instantly, with a kg to lbs chart. 1 kg = 2.20462 lb, using the exact definition of the pound. Free, nothing to install.',
    tagline: 'Kilograms to pounds, both ways, with a handy chart.',
    keywords: ['kg to lbs', 'kilograms to pounds', 'kg to pounds', 'convert kg to lbs', 'kg to lbs chart', 'kg to lb', 'how many pounds in a kg', 'kg to stone'],
    steps: [
      'Type the weight in kilograms.',
      'Pounds appear as you type. Type in the pounds box to convert the other way.',
      'Check the chart for common weights, or switch to stone, ounces or grams.',
    ],
    faq: [
      { q: 'How many pounds are in a kilogram?', a: 'One kilogram is about 2.20462 pounds. The exact relationship is set by the pound, which has been defined as exactly 0.45359237 kg since 1959.' },
      { q: 'Is there a quick way to do it in my head?', a: 'Double the kilograms, then add 10% of that result. For 70 kg: 140 + 14 = 154 lb, against an exact answer of 154.32 lb.' },
      { q: 'What about stone?', a: 'In the UK and Ireland, body weight is often given in stone. One stone is 14 pounds, or about 6.35 kg. Pick stone in the unit list to convert to it directly.' },
    ],
    related: ['lbs-to-kg', 'bmi-calculator', 'unit-converter'],
  }),

  variant('temperature', 'c', 'f', [-40, -20, -10, 0, 5, 10, 15, 20, 25, 30, 37, 40, 100, 180, 200, 220], 'What are some common Celsius to Fahrenheit conversions?', {
    slug: 'celsius-to-fahrenheit',
    name: 'Celsius to Fahrenheit',
    h1: 'Celsius to *Fahrenheit*',
    title: 'Celsius to Fahrenheit Converter: °C to °F, with chart',
    description: 'Convert Celsius to Fahrenheit instantly, with a °C to °F chart for weather, body and oven temperatures. Formula: °F = °C × 1.8 + 32.',
    tagline: '°C to °F and back, for weather, fevers and oven dials.',
    keywords: ['celsius to fahrenheit', 'c to f', 'convert celsius to fahrenheit', 'celsius to fahrenheit formula', 'celsius to fahrenheit chart', 'fahrenheit to celsius', 'oven temperature conversion', 'degrees c to f'],
    steps: [
      'Type the temperature in degrees Celsius. Negative numbers are fine.',
      'Fahrenheit appears as you type. Type in the Fahrenheit box to go the other way.',
      'Use the chart for weather, body and oven temperatures, or switch to kelvin.',
    ],
    faq: [
      { q: 'What is the formula?', a: 'Multiply by 1.8 (or 9/5) and add 32: °F = °C × 1.8 + 32. Going back, subtract 32 and divide by 1.8.' },
      { q: 'Is there a quick mental shortcut?', a: 'Double the Celsius figure and add 30. It\'s exact at 10 °C and stays within about 3 degrees between 0 °C and 25 °C, but drifts further off at oven temperatures.' },
      { q: 'What oven temperature is 180 °C?', a: '180 °C is exactly 356 °F. Recipes usually round it to 350 °F, which is close enough for baking.' },
    ],
    related: ['unit-converter', 'ml-to-oz', 'kg-to-lbs'],
  }),

  variant('length', 'km', 'mi', [1, 2, 3, 5, 8, 10, 15, 20, 21.0975, 42.195, 50, 100], 'What are some common km to miles conversions?', {
    slug: 'km-to-miles',
    name: 'KM to miles',
    h1: 'KM to *miles*',
    title: 'KM to Miles Converter: kilometers to miles, with chart',
    description: 'Convert kilometers to miles instantly, with a km to miles chart including 5K, 10K, half marathon and marathon distances. Free, works offline.',
    tagline: 'Kilometers to miles, both ways, race distances included.',
    keywords: ['km to miles', 'kilometers to miles', 'km to mi', 'convert km to miles', 'km to miles chart', 'miles to km', '5k in miles', 'marathon in miles'],
    steps: [
      'Type the distance in kilometers.',
      'Miles appear as you type. Type in the miles box to convert the other way.',
      'The chart covers everyday and race distances. Pick other units such as nautical miles if you need them.',
    ],
    faq: [
      { q: 'How many miles are in a kilometer?', a: 'One kilometer is about 0.621371 miles. The mile is defined as exactly 1.609344 kilometers.' },
      { q: 'How do I estimate it in my head?', a: 'Multiply by 0.6, or by 5/8 for a closer answer: 8 km is about 5 miles. Going the other way, multiply miles by 1.6.' },
      { q: 'How long are a 5K, a half marathon and a marathon in miles?', a: 'A 5K is 3.11 miles and a 10K is 6.21 miles. A half marathon (21.0975 km) is 13.11 miles, and a full marathon (42.195 km) is 26.22 miles.' },
    ],
    related: ['mph-to-kmh', 'feet-to-meters', 'unit-converter'],
  }),

  variant('length', 'ft', 'm', [1, 2, 3, 4, 5, 6, 7, 8, 10, 20, 50, 100], 'What are some common feet to meters conversions?', {
    slug: 'feet-to-meters',
    name: 'Feet to meters',
    h1: 'Feet to *meters*',
    title: 'Feet to Meters Converter: ft to m, with chart',
    description: 'Convert feet to meters instantly, with a feet to meters chart. 1 ft = 0.3048 m exactly. Handy for heights, rooms and building plans. Free.',
    tagline: 'Feet to meters, both ways, with a quick chart.',
    keywords: ['feet to meters', 'ft to m', 'convert feet to meters', 'feet to meters chart', 'meters to feet', 'feet and inches to meters', 'height in meters', 'foot to meter'],
    steps: [
      'Type the length in feet. Decimals and fractions like 5 1/2 both work.',
      'Meters appear as you type. Type in the meters box to convert the other way.',
      'Use the chart for common lengths, or switch to inches, yards or centimeters.',
    ],
    faq: [
      { q: 'How many meters are in a foot?', a: 'Exactly 0.3048 meters. That has been the definition of the international foot since 1959.' },
      { q: 'How do I convert feet and inches, like 5\'10"?', a: 'Turn it into inches first: 5 × 12 + 10 = 70 inches. Then switch the from unit to inches: 70 inches is 1.778 meters.' },
      { q: 'Is there more than one kind of foot?', a: 'The US used a slightly longer "survey foot" for land surveying, about 2 parts per million longer. It was retired at the end of 2022. Everyday measurements use the international foot shown here.' },
    ],
    related: ['cm-to-inches', 'km-to-miles', 'unit-converter'],
  }),

  variant('volume', 'ml', 'floz-us', [5, 15, 30, 50, 60, 100, 120, 200, 250, 330, 500, 750, 1000], 'What are some common mL to oz conversions?', {
    slug: 'ml-to-oz',
    name: 'mL to oz',
    h1: 'mL to *oz*',
    title: 'mL to oz Converter: milliliters to fluid ounces (US & UK)',
    description: 'Convert milliliters to fluid ounces instantly, US or UK. 1 US fl oz = 29.5735 mL. Includes a mL to oz chart for drinks, bottles and recipes.',
    tagline: 'Milliliters to fluid ounces, US or UK, with a chart.',
    keywords: ['ml to oz', 'ml to fl oz', 'milliliters to ounces', 'convert ml to oz', 'ml to oz chart', 'oz to ml', 'how many ml in an ounce', 'ml to cups'],
    steps: [
      'Type the volume in milliliters.',
      'US fluid ounces appear as you type. Pick "fluid ounce (UK)" for imperial ounces.',
      'Use the chart for bottles and drinks, or switch to cups, tablespoons or teaspoons.',
    ],
    faq: [
      { q: 'US or UK fluid ounces?', a: 'A US fluid ounce is 29.5735 mL and a UK (imperial) fluid ounce is 28.4131 mL, about 4% smaller. US recipes and labels use the US ounce; older British recipes use the imperial one.' },
      { q: 'Are fluid ounces the same as ounces?', a: 'No. Fluid ounces measure volume, while ounces (oz) measure weight. They only roughly line up for water: one US fluid ounce of water weighs about 1.04 oz. For flour, sugar or oil, weigh it instead.' },
      { q: 'Why does a label say 1 fl oz = 30 mL?', a: 'US nutrition labels round a fluid ounce to 30 mL. That\'s fine on a label but about 1.4% off, so this converter uses the exact 29.5735 mL.' },
    ],
    related: ['celsius-to-fahrenheit', 'unit-converter', 'percentage-calculator'],
  }),

  variant('speed', 'mph', 'kmh', [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 100], 'What are some common mph to km/h conversions?', {
    slug: 'mph-to-kmh',
    name: 'MPH to km/h',
    h1: 'MPH to *km/h*',
    title: 'MPH to KM/H Converter: miles per hour to km/h, with chart',
    description: 'Convert miles per hour to kilometers per hour instantly, with an mph to km/h chart of common speed limits. 1 mph = 1.609344 km/h exactly.',
    tagline: 'Miles per hour to km/h, both ways, speed limits included.',
    keywords: ['mph to kmh', 'mph to km/h', 'miles per hour to km per hour', 'convert mph to kph', 'mph to kph', 'kmh to mph', 'speed converter', 'mph to kmh chart'],
    steps: [
      'Type the speed in miles per hour.',
      'Kilometers per hour appear as you type. Type in the km/h box to convert the other way.',
      'Check the chart for common speed limits, or switch to knots or meters per second.',
    ],
    faq: [
      { q: 'How many km/h is 1 mph?', a: 'Exactly 1.609344 km/h, because a mile is exactly 1.609344 kilometers.' },
      { q: 'How do I convert in my head?', a: 'Multiply mph by 1.6, or by 8/5: 50 mph is about 80 km/h. To go from km/h to mph, multiply by 0.6 or by 5/8.' },
      { q: 'Which countries use mph?', a: 'Road signs in the United States and the United Kingdom use miles per hour, as do a few smaller countries and territories. Most of the rest of the world uses km/h.' },
    ],
    related: ['km-to-miles', 'unit-converter', 'percentage-calculator'],
  }),

  variant('weight', 'lb', 'kg', [1, 2, 5, 10, 20, 50, 100, 120, 140, 150, 160, 180, 200, 250], 'What are some common lbs to kg conversions?', {
    slug: 'lbs-to-kg',
    name: 'Lbs to kg',
    h1: 'Lbs to *kg*',
    title: 'LBS to KG Converter: pounds to kilograms, with chart',
    description: 'Convert pounds to kilograms instantly, with a lbs to kg chart. 1 lb = 0.45359237 kg exactly. For body weight, luggage and recipes. Free.',
    tagline: 'Pounds to kilograms, both ways, with a ready chart.',
    keywords: ['lbs to kg', 'pounds to kilograms', 'lb to kg', 'convert lbs to kg', 'lbs to kg chart', 'pounds to kg', 'how many kg in a pound', 'kg to lbs'],
    steps: [
      'Type the weight in pounds. Fractions like 1/2 work too.',
      'Kilograms appear as you type. Type in the kilograms box to convert the other way.',
      'Use the chart for common weights, or switch to ounces, stone or grams.',
    ],
    faq: [
      { q: 'How many kilograms are in a pound?', a: 'Exactly 0.45359237 kg. That has been the international definition of the pound since 1959.' },
      { q: 'Is there a quick way to do it in my head?', a: 'Halve the pounds, then take away 10% of the result. For 150 lb: 75 − 7.5 = 67.5 kg, against an exact answer of 68.04 kg.' },
      { q: 'How do I convert pounds and ounces?', a: 'There are 16 ounces in a pound, so 7 lb 8 oz is 7.5 lb, or 3.40 kg. You can also pick ounces as the from unit and type the total.' },
    ],
    related: ['kg-to-lbs', 'bmi-calculator', 'unit-converter'],
  }),
] satisfies Tool[];
