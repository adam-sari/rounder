import { describe, expect, it } from 'vitest';
import { bunzip2 } from '@/tools/lib/unzip/bzip2';
import { unxz } from '@/tools/lib/unzip/xz';
import { baseName, gzipStoredName, isSplitPart, normalizePath, previewKind, safeSegments, sniff, unwrappedName } from '@/tools/lib/unzip/formats';
import { buildTree, initialExpanded, prefixSums, visibleRows } from '@/tools/lib/unzip/tree';

// fixtures made with the bzip2 and xz command-line tools from these inputs
function sample(kind: 'text' | 'random') {
  if (kind === 'random') {
    let a = 9;
    return Uint8Array.from({ length: 600 }, () => (a = (Math.imul(a, 1103515245) + 12345) >>> 0) >>> 24);
  }
  const words = ['archive', 'rounder', 'zip', 'folder', 'tool', 'night', 'sun', 'chalk', 'byte', 'stream'];
  let s = '';
  for (let i = 0; s.length < 30000; i++) s += `row ${(i * 31) % 997} ${words[i % 10]} ${words[(i * 7) % 10]}\n`;
  return new TextEncoder().encode(s + 'z'.repeat(2000) + 'ab'.repeat(300));
}

const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
// bzip2 -1
const TEXT_BZ2 =
  'QlpoMTFBWSZTWSte2hIAL2jZgoAQQAB/4D/v37AIAAAIYBL4AAAAG4AAAAD4iMImsQiEREIhEIggAQAwyMCaYEyGJowElDGmqlU2k8o9QDTTJ6giqp//pD3q' +
  'qqgAAGgAKA/IqVUGnpAAADDIwJpgTIYmjAin/qkGmVVTIA0NNAD9fh+ebub+/w/X8Z8NuPXjN4JMqBNm1KmQew3CMFZMqYqLG4ZIPGyVkwRUqYm0sblyxhzg' +
  'kzqeJF40yPPG573idzvYqZU3uid9GmSO9HeyVBLU2VMillczcRgJEbFRUMTdPGyEYkRUypgkixtxAwkqCRXNypkPLG43dRgqZU2KjyGSHOPGyd9GEdqZqYpY' +
  '9y4nASZfNcSKlTJ7xzljcIx2pqZUVBu6ZIPG7NlRhFS4mKWNuJIwEmVDdcipUyCeNwjKXW5Ux5FjdMkFrZK5zgj1lTHe05O7lxGHunJM4gkXK3WQeNxiMIqZ' +
  'UXdcixpkisgkqCRlSpkCyJjEYCSSoqKhszR42Qjd0iplTBzvFjfZ6Ae3ZKnSRXdqZHSxuO91GPeqZU3qpzqGSHvI5slRhFxMqYpYvJiASZWQSKlTJGCxuVGJ' +
  'CplRUX3N417JB43d2owipY3FLG3HOcYLZMqHeOR1PJkHPG47GC+bmpiosb4yTTxslevG8ipUwrdsblxGHfMbJjsEishkHjfiIwiplSTBFjTJE0ElsE5xU6mT' +
  '1LOOYxGeCTkqOoqG93gtbIR3ukd9MqYOW9bOb3EDpJqCKa2ZFLG4yxNwVMqEbFQyCTxshGEZUypiljcuIBJdaJBKmTdDvj6ZX7IQJJHkkIPt9ft9vr9/t9/P' +
  'M9/PMz7t628AqhslX3FqtXAFAqleteIoEFbMRRDRVqNwoeK4WyAQOFVWAXq7CAVSv4znOM4x958zcn0QIbD5VIByredW9QLwC9QIBiqBALhehuAVa2TagUC7' +
  'UOwCsg6egVQWK2QC8C8Kd/XnOcZxi9C4tIBVD5o6fLVauwL0Kp41AKoEwcCvQIBbJtZLIuFAqgQPF2gQC6UCIVbxHV6gUC4X8sZzjOMXve/W/L1rwD4C2RWo' +
  'K9I82BVA1AKlVrYr0CqGFitkAvAL1wBAMVarVAvQ3VAhV2oEAu38ZznGcYOnrw+CgXTJ9JPRDRTxqiBA0VTxAKirFKscbWqpQL1dhAKuAIBVDhDhVqtZFaor' +
  'oPERs/TnOcZxjs7ffW/KfKGyh2qBCrtQIHC+W85JXoF0BVQhoKvggFG7VqiteLXoFCNmIrQIvAIrVDpNhfxnOcZxj0n3J8kCv0xFaBHaBFKtXDVAoDZ6O0Aq' +
  'qsVqhooFGq1TAUCqaCB6qBKuHihHQLZFUPyznOM4wzm7bSNg6egfLWSWRRAo6AgFU2EOlUPEVslVrh4BVapwJwKoE0BVVYu2k1PLVCugKoE/POc4zjB8GPin' +
  'y/K/OnobvgqhHQFUCdDdUCAXa1eeqqyq9UCBhbIqgV6myAVbJJZEENF8qMQqmAv55znGcY95Z92/VAivn6cQTAdqqwCuECgVa+WyKUCaUCIVdgToVTxqYAq1' +
  'WvEOUCqRdgVQwSVVX71dbP4zuh7BXhmD2Ca3vOSZg53O3zrU84V3N7nQ9rJO+d7vi5nnXJnll2TdF3ujtHaKoXYux6x62tS61rm7dWefXvr7z3obIdnThzfS' +
  'Eew3jffPiTx13jZAxOzq8xOdDE92eeTfehiHYbxsnVcQ67xvxFnfd4c33fZOzkofX7S8OZReDWcF3rROj1k6MnWxWCAzWSZgnQnTkzlirGu2PWN1qqbmaod7' +
  'RdlX3kzez1jV0Lu+V7z9ufK+O56xJ1l25kzb5k6Ab49jluby8lAG+POVbcyVYlvuuetsmVL0AdS7q2yPJeAG12q2ZulPJ1Jb6tr1vZr9U0Al92/ZXscnbAG6' +
  'zly5Pbcvwl75znKvl9n2vHsM1yV2a01oVd9mVcupznR3x2c1KfGrw7vjezW8Ls569TKrHb1PWTNUOZ6XrG8bmfWPX6Zbvw5apj0xWVb+cmS7ANqqcvN2GOrQ' +
  'G+7xyrtuDlWJZ7rnrpuOVaSboqU2StyZ4A2r9d0S+vZjOfanuE8stOdM5y9e78x9LOnd4A3aKlZrl9l9Et2ipTZKuQA57nH85zmZvNGsMwme2Pc1oXtyZuzm' +
  'tjey61ehUy1djnVT3fByuSes5d5M+w7lPTqe0dpye0Zgnli7O3Zfju9cjWs+Z8JUsA33XKq9zdhLq0lnt5W23B1L6kt2vcqW3KcvqA3azO5MqeqRJbm31u8c' +
  '25aSfs5WPc2bcd9AN8exzd2Xl0AbtFSrbJcq0lu9nrtsmVNANc5zfmd7PnF9yWpqxfanezej1mtGtHqBybsXY3rY1scsXq5esetuZrux3o92guxO7F2d9bJn' +
  '2CspzeNZu7uPclpJ+PY9vdhcd9SW+r3aceSpWgF33dynfnHc9iSdN5kyZtyvCToqslyby8lAG+PY5e7LyogN93jl03MuXgl73ZPXTZHcvAB1VSrbJ7J0Aqc5' +
  'y5znPj5znzec+YXZOtaE3Yu3e74N83MvW1qtbyZZg733c501zhysl7Bujc3F1sVQqh2j1l2esesXYru8nve5V+3zLj77b1evt4456oASXt9y8pz1yvADqs5c' +
  'uW5zJfhLaqpWR8mSgDfHnK3N2DurAN91yqtuOVBJut5dW3HWTPJLar3KltkeTmvoiPb57fe+v3dbuo++rjfBrlDPHMzJlljuVvY13cmYJ0J1yZVggX4uidDN' +
  'bF4LwzDMFU7Q7upKiuXfOV2bznLyX7uznNzldnuPezPlfJNz2JJ+zlSOZWy+gG7RUpt8l5MwA2qKlW2TJYBvuz1Om4S6sAzznb3N2G3VpJuipTcrZfUlu1dd' +
  'uY8leuaAZzapu3Udy8SVb1U8rt16/c7uY++3w73xdnbwZ4c5ZvadJmfWO95xvhrlnuzpexduTNb56d52Ttis56WYM32TmjfKmedKq5ZOWcv4+9ufOc5fznL7' +
  'fznL8e2Zs+S8qgB+PSNkqS+JLu72eq2yZUvBLeV2du7bJUsAzx7Kdt7OY76kt93nsc3ZV+1JVu37O5MqekANv2623kdz2ADrLtzLml5PCW+PXV87Vxy659ER' +
  'y3bTM10c3Vl4OXuZemWTlmeqdbFb2Ms9prQyzs117XDWyr6X4XzkyuyuFUJqh2nZ9ZfjuTO92c5y/TvObmc8/k2XXy+gG89J22yZUvRJ1Lu7bzkyWwDa7yq2' +
  'ZN5t5PIDfdrtY49lduJKXtdy8pydtJN033JkvauXQA6qpUxk9ksS31U5ebsM274ku73rlVbq4q99iIjPe63M9sV6pXWS5js8ud1M72Ls3OtidjtCB6y7NaJ0' +
  'PXuZesXYuh2qoTVCqdm7FWO3R63Kqd5Jz5Mt928+fMv5eCTqipTc5uS/CW13buZtztzUBe13Nt29kfsaS2vPt3LcdyuiW7RUrWyXKoA3aKlNkqZADezvt3dJ' +
  'VWku5vabejqtAM8e88zStroj8f2SEIP0EkIPqhIQUJIQf3BIQcBJCiP4R999H0R+X7xAgIEIIQfAIECCEBAgQIECEIQgQIAQPh8QgIECBCBAgQIECA+QQIEB' +
  'AghAhAIQIED4QgQIEAPh8QgQAhBCCB8AgQIPoj76IfffR9Efy/2QPhBCAgQIEIIQIECBAIIQfCBAQIIQIQBAgQIIQhBCCBAD4QQgQQCBCD5BAQIHwgIQfCBA' +
  'gIIQIQQAgQPiHwCBAgHDnOc4cOAJBxJCCkJCD/SQkIMQkIP1EkIP0BJCD9RJCCCSEH4EkIPoJIQfwEkIP2SEhB9EhIQf9BJCD4JIQeEkIP3QkIPzEkIPzSBA' +
  'JfQSQg+qQkINEkIKQkIGJIQfb9wQJJHUhIQfkJIQfgSQg6JIQfhISEH5CSEHwSQg4hAkkMSQgoSQg/8lv1AD/4u5IpwoSBWvbQkA';
// xz defaults: CRC64 check
const TEXT_XZ =
  '/Td6WFoAAATm1rRGBMCGEuP+ASEBFgAAAAAAABfyTkXgf2II/l0AORvLUCCfrW3oR2JtKF0cRiuuxng2oefF8Ivb1lzh9V8nUInSxkjZ3FO8Frpo4TDjIApc' +
  'Sv4NHTe4gsirY0A1/xR4Ny1RePK0HK6TpEkWPEQMvMQJxeFg3UgTbmp38hwaaBtuZ/TcyaLHaOuhAVzsmEQexBugxr3thZJ6jwP/RBeKkWoT+Khoe/qDFkux' +
  'PWXlsm0OzqbEyowyKzuYhcY9eB5RJiIlNUBw62h42HfVVF2c0ZS3XMHqJ68/ID6FCU6/YDQyk6miqGOLB+ppU5zr1Fnhs1TMDXwzkFemj2PKv3/5IdNItM2Y' +
  'kAl1EPaIqb7QjS2VpzSxfm3QHutHL9LN26RW9hc+8WSlGCRvQd7EfqcyxxElQMh6aii4KPT2Zeui7UaIUXXeAbi2/vjr75uH22uULLtW02FaKoiNEeBXkwGs' +
  '7cYm7LcLxHtbBpzepLohyB6sKmrh4d38pkdsY3g59WQHqfKcOMTXzxCaA3Q8YX+3LQxRFvwxfhKG1dxufv9eYqkcF9V+cRylwnoK0FJvqm7Au/20XxzCYJEP' +
  'p8FzUuFqcB4A2yyMvnlFALXzgUOgiLhDW2UsMHfFAqncfDpXqEpa0tVrbEe6hGi2H2bmX79w4ZHj+/4jA7jey9szOMpr3neS/WDaMxi8LydFmjCwSVqoTGf1' +
  'b2IuLONzKKXr19z4yqNlcdMvX/+FdHz9GzAh1WdE+USQ6xiqaHwdl24GIj+CLaZzo09I2T5WExxgDncTW0f8X8bVTIV0OrJqNgUdT8hL/xOETvuluLQYiE+e' +
  '4c7hsxrH99lyyeXve+4nL0ZMTOy6wzLH7QdakCtsI4vRA5TgRbQIjuRsvh8SMIcAk31rPaJVl3yYcJbju1cVnhJbTBxO9iNVF4/dTAKDG01WZIGFjHIEyKaq' +
  'IYXoCbGkxsqUDiCaMwPYiKP8l0XESE6BK2wMYk6gG0bYzyzkmFlWYw/QOT5Phk9uM7F+xo+/5rBNJIleCH9CjFV0+9oWRfISQM8VWMh2uoulhVkGkaCKiE+k' +
  'Ku7maLICtEmZQSrxOyDTxzzycROJig607uPGtOQLATX2U0yjN7gK69dX3E1ylAuUgT5iqI/39yL3jgUe6y+gToc2reBonm6CXk3LwGjFRh6iN0S8NicyrsRU' +
  'yYc1vx+7WPvfsG/JxcCQc+oF1zhG8OcWcjg5Uci3Ieg9hnDy5+6ySC7nPbn4VYEC5ectn4F26qd8In1URaIK822qKDzvchscgwYsTDEHG2CFCE1I7gAEgVXX' +
  'yilbIzr3e/+0vBbvlRhTZdYU7Kq3XYPFSgSYoOdJfJk/7k7Nk2Jzsgt5nqbr8Ulz/HyXGEcja9LjF4yPvYPa5mHQo39iLyePEkzPmEONnaI1QP2euE2T7O32' +
  '8w5X1sXW/qRd8wbkSdLhA2c7ZzwQquS1NJDWOqd92LZVTrXQKeSwcVZBzJ93agCQFkCiGvUi10WgphQv1RyJLu4DqOMJd/WyXEKmXl1XqJ6D37BLI+Fi2P//' +
  'XQpaQpks+5Jxu3nTsN06Rn/86axow5Nx85c4YFAz+fPFRC6y3zKiHgZbXj3vzPyb99eoXruWuGZfBXuadFYZ8ExNX5oc2IPcpUGMCgrIOgJUOKHx/dxtBwZ6' +
  '70nswmOM/jKOrcsvIX+IRiVWAlEncQ9lvhbdqT/duvD4a8+YA/erFQWrc8w+d+xP8znKaFj/7bFAH63I57Huyp6Nk/fa32wtnx/XATKyjy6dOKrM/NuidPEx' +
  'pvU/R60A4K5cq2x3LEcUYvgFWMj8gXpMaYQmtiRqFbbmYVmOu+eg0FZacx11tF2CnYKqWa7q4gZqGTefg1FEQCLR11SAjCmm3XJUC273Xw002QjfjABs+lqL' +
  'J66zDtMh3z7EqghY1GpBNXo08vQFsdRlV4Qn+JKp+I1aWW23mgyRtuY2r/0yasxgAAvIRVPDiyKLap/hMTC2YPNeMiGd8JmnOUUrbQ72iHgaAFWYv/bsa/eX' +
  'FexmplYXJ4MQwxRHaEZ31FcCv5G7F2u2/MdISvhxeqSJy+BmorNlvcj/KQV+QnQ0zMGXWdYYSN4dvt2F4EA+UtBjgTO4QpN8Q23emb7DpUXO3rG9e/gsnatG' +
  'h+c0qkSkaOjxGE1gJKdxdmQlapkDKJ3dzgAZ7m3uzuWa47WNQYeCGLTGrUHoqCl/2c6jhEyvvL+uBK8RdX3sDwTMwFL5gXR/1FXqQEb8muzBgGYpeF632jVK' +
  'Q0Sl/7kvmPb2j1c15Zx7GRtQ8euE3zmTPxtWk6NfyPZBwoMfc82fo7NbACRw7muT6E5SWYpt26Mu3B1yZGl7JRrIhwLy7+nGBAy6QSTYI/8fNuuSXDfsuKfl' +
  'YzNSpToCuXRljWLSChdaH5cDwA3GKvN3XjR5/nvRY4k4npn7UoxlJn3C8YYPJkdqJHJjO2xJbHMv4Sz89UYXoDbo1v3M8I7wBDLpbewc8SNAqM3LVe7dhvmX' +
  'fOhWU64tva8HaA4iNlj3YhKXKJNGR5YFPqAehowG0GF2Tt81PbgiNu9E/J7xNRjtjBgYH/ZOmyo++AF81w3BYR263LSQBuM94XcVJuw4CCvhs2moc2urctZQ' +
  'UrWjSLnRRA7OFBxZrADJ4Cq+jcpRKnQuXI/ET/b/u3s9kHONLX6pEV2LP2lx3AW1VVVwM0eBdgY+I2wQ7toyn8foE4gA3gADU39YElzkCuBS25PeY6TzKfBc' +
  'ZHFm1COLEXtbQ+jXgQF1Kefe71ThCfMYalkoi0WHeCHKcQ1rr7vx/uQiMYhwJX+TYsgXuSmN9Z4RtQePwV+TfEd+Bn1rbMxn6m/no/dtysDPhkVtMyvjlvZ5' +
  'rUi7mWiNWxmvJM5DJa1gsKpdo7a3hQSgBDVorJDJuGHM8WuKiOcAanTFavI1omV9KryG3c7gCthwUmEOizxIEIeB2qksc7x5hewz44OcStLjOUBhbZsLobIC' +
  'IPPeSsGtIUWa94ziXkJ3PdtLl/ftoVwzmon0cG8Sm44OM2zxNJVIjVzSbKrmFX8vlrLkRxd9JQESTW3m8lRE99h4cGDLwY1th16h8PlQ40HZptoo8yoMuh30' +
  'AAAAAMTa3mrpubv7AAGiEuP+AQCXISrvscRn+wIAAAAABFla';
// xz -9e -C crc32
const TEXT9_XZ =
  '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';
// incompressible, so stored as uncompressed LZMA2 chunks
const RANDOM_XZ =
  '/Td6WFoAAATm1rRGBMDcBNgEIQEWAAAAAAAAAEEnmxUBAldPqys0VjSzGz+I4XOO99nA/jQY2rMv/42kz454xVehSDyl7uSwgqsjgd2FO2V+UejQnLAJGm6H' +
  'J0GP9CrG1Ds/+PDGj78DMWmf7wb8lgyYqhWbKbQbE0izTiYQF5AVt7her5UmDyKYM7RqwQYjBS2XjEO5aopXS/ON7lTqKwwHhZFkZ1U8aBxBqNS+5pll+UBB' +
  'A8N1R46EJowb3Y8qRIt0BOp1hex26c8vkK5iEchQL4ml1tw+LNIFo752LKznDk1yeCPb0Q4Ulcje838xZPTsB02rYWi8A8f6xZMhXrnH1uWjATipCaDIwdiY' +
  'eyoMEvmsfyqEyenNHoL4Vgx1GlnQsVzOOD9hehcwdVXUuS5D17AZZoByeNY4+fyMyLYH0/h47XA0aih9r/mIjEAn1I0AnFOcSn9LrcDpUrBqcBmvCCX+/UEL' +
  'jm84zcBOtEulX+tCxTeWGF7O26dX50N+g9a085W1LxHdAtYnqFdfheSYDMBgz9JyzKIsVkQD4kcWm65lEASMdn/TKk6oDazDboDSgnMlKczKfNLjLoEQwD68' +
  'o00shaBB9W5PVwGERH6/zKg/pimCdKmcZggHitNmBWQ8yAH6b4ThSN8i1H0Ku+2e9voB9IDB2DD+TJr1bEcPKx89AlW6XfzD7VoaYh4Mq4MeAOXNgBjeTi3/' +
  'kkJa+JsU7GMAsv/2Hy0Jd6xM3I5Gc4DuECif6mL7AT9yoFWdh41BOiZZdYc9wT++O/3b66nUd6mborKyJigE+JzoVeZLcrgP/cESUWWlGT1X5e9XW3haZv4G' +
  'TfkGrz0A4Ej5x4Gcu3gAAfgE2AQAAMPQ/SuxxGf7AgAAAAAEWVo=';

function run(decode: typeof unxz, input: Uint8Array) {
  const parts: Uint8Array[] = [];
  decode(input, (c) => parts.push(c.slice()));
  return concat(...parts);
}
function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

describe('bunzip2', () => {
  it('decodes a bzip2 file, runs and all', () => {
    expect(run(bunzip2, bytes(TEXT_BZ2))).toEqual(sample('text'));
  });
  it('decodes concatenated streams', () => {
    expect(run(bunzip2, concat(bytes(TEXT_BZ2), bytes(TEXT_BZ2)))).toEqual(concat(sample('text'), sample('text')));
  });
  it('rejects damaged, truncated and foreign data', () => {
    const bad = bytes(TEXT_BZ2);
    bad[200] ^= 0xff;
    expect(() => run(bunzip2, bad)).toThrow(/damaged|ends too early/);
    expect(() => run(bunzip2, bytes(TEXT_BZ2).slice(0, 500))).toThrow(/ends too early/);
    expect(() => run(bunzip2, new TextEncoder().encode('hello'))).toThrow(/not a \.bz2/);
  });
});

describe('unxz', () => {
  it('decodes LZMA2 with CRC64 and CRC32 checks', () => {
    expect(run(unxz, bytes(TEXT_XZ))).toEqual(sample('text'));
    expect(run(unxz, bytes(TEXT9_XZ))).toEqual(sample('text'));
  });
  it('decodes stored chunks', () => {
    expect(run(unxz, bytes(RANDOM_XZ))).toEqual(sample('random'));
  });
  it('decodes concatenated streams', () => {
    expect(run(unxz, concat(bytes(TEXT_XZ), bytes(RANDOM_XZ)))).toEqual(concat(sample('text'), sample('random')));
  });
  it('rejects truncated and foreign data', () => {
    expect(() => run(unxz, bytes(TEXT_XZ).slice(0, 800))).toThrow(/ends too early|damaged/);
    expect(() => run(unxz, new TextEncoder().encode('hello'))).toThrow(/not an \.xz/);
  });
});

describe('formats', () => {
  const head = (sig: number[] | string, at = 0) => {
    const h = new Uint8Array(0x8006);
    h.set(typeof sig === 'string' ? [...sig].map((c) => c.charCodeAt(0)) : sig, at);
    return h;
  };
  it('sniffs archives by their first bytes', () => {
    expect(sniff(head([0x50, 0x4b, 3, 4]))).toBe('zip');
    expect(sniff(head([0x50, 0x4b, 5, 6]))).toBe('zip');
    expect(sniff(head([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]))).toBe('rar');
    expect(sniff(head([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))).toBe('7z');
    expect(sniff(head([0x1f, 0x8b, 8]))).toBe('gz');
    expect(sniff(head('BZh9'))).toBe('bz2');
    expect(sniff(bytes(TEXT_XZ))).toBe('xz');
    expect(sniff(head('ustar', 257))).toBe('tar');
    expect(sniff(head('CD001', 0x8001))).toBe('iso');
    expect(sniff(new TextEncoder().encode('just some text'))).toBeNull();
  });
  it('reads the name stored in a gzip header', () => {
    expect(gzipStoredName(bytes('H4sICGWS32oAA3Jhdy50eHQAy0jNyclXKM8vyknhAgAtOwivDAAAAA=='))).toBe('raw.txt');
    expect(gzipStoredName(bytes('H4sIAAAAAAAAA8vIBACsKpPYAgAAAA=='))).toBeUndefined();
  });
  it('names the unpacked file', () => {
    expect(unwrappedName('notes.txt.gz', 'gz')).toBe('notes.txt');
    expect(unwrappedName('site.tgz', 'gz')).toBe('site.tar');
    expect(unwrappedName('dump.sql.bz2', 'bz2')).toBe('dump.sql');
    expect(unwrappedName('backup.txz', 'xz')).toBe('backup.tar');
    expect(unwrappedName('download', 'xz')).toBe('download.out');
    expect(unwrappedName('x.gz', 'gz', 'report.csv')).toBe('report.csv');
  });
  it('spots split archives and base names', () => {
    expect(isSplitPart('photos.part2.rar')).toBe(true);
    expect(isSplitPart('backup.7z.001')).toBe(true);
    expect(isSplitPart('data.z01')).toBe(true);
    expect(isSplitPart('photos.rar')).toBe(false);
    expect(baseName('site.tar.gz')).toBe('site');
    expect(baseName('Holiday Photos.zip')).toBe('Holiday Photos');
  });
  it('picks a preview by file name', () => {
    expect(previewKind('a/photo.JPG')).toBe('image');
    expect(previewKind('icon.svg')).toBe('image');
    expect(previewKind('notes.md')).toBe('text');
    expect(previewKind('LICENSE')).toBe('text');
    expect(previewKind('song.mp3')).toBe('audio');
    expect(previewKind('clip.webm')).toBe('video');
    expect(previewKind('setup.exe')).toBeNull();
  });
  it('keeps extracted files inside the chosen folder', () => {
    expect(normalizePath('./a\\b//c.txt')).toBe('a/b/c.txt');
    expect(safeSegments('../../etc/passwd')).toEqual(['etc', 'passwd']);
    expect(safeSegments('/abs/path.txt')).toEqual(['abs', 'path.txt']);
    expect(safeSegments('a/what?.txt')).toEqual(['a', 'what_.txt']);
    expect(safeSegments('con.txt')).toEqual(['_con.txt']);
    expect(safeSegments('dir./file. ')).toEqual(['dir', 'file']);
    expect(safeSegments('../..')).toBeNull();
  });
});

describe('tree', () => {
  const entries = [
    { path: 'proj/src/b.ts', size: 20 },
    { path: 'proj/README.md', size: 5 },
    { path: 'proj/src/a10.ts', size: 1 },
    { path: 'proj/src/a2.ts', size: 2 },
    { path: './proj/src/a2.ts', size: 3 },
    { path: 'proj/assets/logo.png', size: 100 },
  ];
  const tree = buildTree(entries);

  it('sorts folders first, in natural order, and totals sizes', () => {
    const proj = tree.root.children[0];
    expect(proj.name).toBe('proj');
    expect(proj.children.map((c) => c.name)).toEqual(['assets', 'src', 'README.md']);
    expect(proj.children[1].children.map((c) => c.name)).toEqual(['a2 (2).ts', 'a2.ts', 'a10.ts', 'b.ts']);
    expect(proj.size).toBe(131);
    expect(proj.count).toBe(6);
    expect(tree.folders).toBe(3);
  });
  it('numbers files in display order, with folder ranges', () => {
    expect(tree.files.map((f) => f.path)).toEqual([
      'proj/assets/logo.png', 'proj/src/a2 (2).ts', 'proj/src/a2.ts', 'proj/src/a10.ts', 'proj/src/b.ts', 'proj/README.md',
    ]);
    const src = tree.root.children[0].children[1];
    expect([src.first, src.end]).toEqual([1, 5]);
    expect(tree.files[3].item).toBe(entries[2]);
  });
  it('opens a lone top folder and lists visible rows', () => {
    const open = new Set(initialExpanded(tree.root));
    expect([...open]).toEqual(['proj']);
    expect(visibleRows(tree.root, open).map((r) => r.name)).toEqual(['proj', 'assets', 'src', 'README.md']);
    expect(visibleRows(tree.root, open, 'A2').map((r) => r.path)).toEqual(['proj/src/a2 (2).ts', 'proj/src/a2.ts']);
  });
  it('counts selections with prefix sums', () => {
    const sums = prefixSums(Uint8Array.from([1, 0, 1, 1, 0, 1]));
    expect(sums[5] - sums[1]).toBe(2);
    expect(sums[6]).toBe(4);
  });
});
