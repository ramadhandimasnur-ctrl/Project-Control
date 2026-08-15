import { Decimal, toDecimal, type Numeric } from './decimal';

/**
 * Volume take-off — charter section 4.3.
 *
 * A work item's volume is built from traceable rows rather than typed as a
 * single figure, mirroring the VOLUME sheet of the source workbook. Each row
 * carries the arithmetic that produced it, so a quantity can always be
 * explained months later.
 *
 * The expression is evaluated here, by a parser written for the purpose. It is
 * emphatically not `eval` or `new Function`: this text arrives from a form and
 * is stored in the database, and executing it as JavaScript would hand any
 * user with a keyboard the ability to run code on the server.
 */

export type TakeoffRow = {
  label?: string;
  /** Optional arithmetic, e.g. "3 × 4,5 × 0,15". */
  expression?: string | null;
  /** The quantity actually stored. */
  qty: Numeric;
};

/** Total of the take-off rows; this is what `work_items.volume` becomes. */
export function takeoffTotal(rows: readonly TakeoffRow[]): Decimal {
  return rows.reduce<Decimal>((acc, row) => acc.plus(toDecimal(row.qty)), toDecimal(0));
}

export type ExpressionResult =
  | { ok: true; value: Decimal }
  | { ok: false; message: string };

type Token =
  | { kind: 'number'; value: Decimal }
  | { kind: 'op'; value: '+' | '-' | '*' | '/' }
  | { kind: 'lparen' }
  | { kind: 'rparen' };

/** Multiplication and division as written on Indonesian take-off sheets. */
const OPERATOR_ALIASES: Record<string, '+' | '-' | '*' | '/'> = {
  '+': '+',
  '-': '-',
  '−': '-',
  '*': '*',
  '×': '*',
  x: '*',
  X: '*',
  '/': '/',
  ':': '/',
  '÷': '/',
};

function tokenise(input: string): Token[] | string {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const char = input[i]!;

    if (/\s/.test(char)) {
      i += 1;
      continue;
    }

    if (char === '(') {
      tokens.push({ kind: 'lparen' });
      i += 1;
      continue;
    }
    if (char === ')') {
      tokens.push({ kind: 'rparen' });
      i += 1;
      continue;
    }

    // A digit, or a decimal separator introducing one.
    if (/[0-9]/.test(char) || ((char === ',' || char === '.') && /[0-9]/.test(input[i + 1] ?? ''))) {
      let raw = '';
      let separators = 0;

      while (i < input.length) {
        const c = input[i]!;
        if (/[0-9]/.test(c)) {
          raw += c;
          i += 1;
          continue;
        }
        // Both conventions appear in practice; either marks the fraction.
        if ((c === ',' || c === '.') && /[0-9]/.test(input[i + 1] ?? '')) {
          separators += 1;
          if (separators > 1) return `Angka "${raw}${c}" memiliki lebih dari satu koma desimal.`;
          raw += '.';
          i += 1;
          continue;
        }
        break;
      }

      tokens.push({ kind: 'number', value: new Decimal(raw) });
      continue;
    }

    const operator = OPERATOR_ALIASES[char];
    if (operator) {
      // "x" is only an operator between numbers; inside a word it is a letter.
      if ((char === 'x' || char === 'X') && /[a-z]/i.test(input[i + 1] ?? '')) {
        return `Ekspresi memuat teks yang tidak dikenal: "${char}${input[i + 1]}".`;
      }
      tokens.push({ kind: 'op', value: operator });
      i += 1;
      continue;
    }

    return `Karakter "${char}" tidak dapat dipakai dalam ekspresi.`;
  }

  return tokens;
}

/**
 * Recursive-descent evaluation of `+ - * / ( )` with the usual precedence.
 * Unary minus is supported so "-2 + 5" reads as expected.
 */
function evaluate(tokens: readonly Token[]): { value: Decimal } | { error: string } {
  let position = 0;

  const peek = (): Token | undefined => tokens[position];

  const parseExpression = (): Decimal | string => {
    let left = parseTerm();
    if (typeof left === 'string') return left;

    for (;;) {
      const token = peek();
      if (token?.kind !== 'op' || (token.value !== '+' && token.value !== '-')) break;
      position += 1;

      const right = parseTerm();
      if (typeof right === 'string') return right;
      left = token.value === '+' ? left.plus(right) : left.minus(right);
    }
    return left;
  };

  const parseTerm = (): Decimal | string => {
    let left = parseFactor();
    if (typeof left === 'string') return left;

    for (;;) {
      const token = peek();
      if (token?.kind !== 'op' || (token.value !== '*' && token.value !== '/')) break;
      position += 1;

      const right = parseFactor();
      if (typeof right === 'string') return right;

      if (token.value === '/') {
        if (right.isZero()) return 'Ekspresi membagi dengan nol.';
        left = left.dividedBy(right);
      } else {
        left = left.times(right);
      }
    }
    return left;
  };

  const parseFactor = (): Decimal | string => {
    const token = peek();

    if (token === undefined) return 'Ekspresi berakhir sebelum selesai.';

    if (token.kind === 'op' && (token.value === '-' || token.value === '+')) {
      position += 1;
      const operand = parseFactor();
      if (typeof operand === 'string') return operand;
      return token.value === '-' ? operand.negated() : operand;
    }

    if (token.kind === 'number') {
      position += 1;
      return token.value;
    }

    if (token.kind === 'lparen') {
      position += 1;
      const inner = parseExpression();
      if (typeof inner === 'string') return inner;
      if (peek()?.kind !== 'rparen') return 'Ada kurung buka yang tidak ditutup.';
      position += 1;
      return inner;
    }

    if (token.kind === 'rparen') return 'Ada kurung tutup tanpa kurung buka.';

    return 'Ekspresi tidak dapat dibaca.';
  };

  const result = parseExpression();
  if (typeof result === 'string') return { error: result };
  if (position < tokens.length) return { error: 'Ada bagian ekspresi yang tidak dapat dibaca.' };
  return { value: result };
}

/**
 * Evaluates a take-off expression.
 *
 * Returns a message rather than throwing, because an unreadable expression is
 * an everyday typing mistake that the form should explain, not an exception.
 */
export function evaluateExpression(expression: string): ExpressionResult {
  const trimmed = expression.trim();
  if (trimmed === '') return { ok: false, message: 'Ekspresi masih kosong.' };

  const tokens = tokenise(trimmed);
  if (typeof tokens === 'string') return { ok: false, message: tokens };
  if (tokens.length === 0) return { ok: false, message: 'Ekspresi masih kosong.' };

  const result = evaluate(tokens);
  if ('error' in result) return { ok: false, message: result.error };

  if (!result.value.isFinite()) {
    return { ok: false, message: 'Hasil ekspresi bukan angka yang sah.' };
  }
  if (result.value.isNegative()) {
    return { ok: false, message: 'Hasil ekspresi bernilai negatif; volume tidak boleh negatif.' };
  }

  return { ok: true, value: result.value };
}

/**
 * Resolves one take-off row to a quantity.
 *
 * When an expression is present it wins: the row exists to show the working,
 * and a stored quantity that disagrees with its own arithmetic would be the
 * kind of silent discrepancy this whole system exists to prevent.
 */
export function resolveTakeoffQty(row: TakeoffRow): ExpressionResult {
  if (row.expression !== null && row.expression !== undefined && row.expression.trim() !== '') {
    return evaluateExpression(row.expression);
  }

  try {
    const qty = toDecimal(row.qty);
    if (qty.isNegative()) {
      return { ok: false, message: 'Kuantitas tidak boleh negatif.' };
    }
    return { ok: true, value: qty };
  } catch {
    return { ok: false, message: 'Kuantitas bukan angka yang sah.' };
  }
}
