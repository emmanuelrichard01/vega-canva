/**
 * A small mathematical expression language, parsed and evaluated by hand.
 *
 * ## Why not `eval`, or `new Function`
 *
 * The obvious implementation is one line and it is unshippable here. Chart
 * specs live in the **CRDT**: an expression typed by one person is replicated
 * to everybody in the room and to everybody who opens the board later, and
 * `new Function(src)` would execute a string authored by somebody else with the
 * full authority of the page. A board is a shared document, so a formula field
 * backed by `eval` is a remote code execution channel with a friendly label on
 * it. That is not a hypothetical for a collaborative canvas; it is the threat
 * model.
 *
 * It is also strictly worse at the job. `eval` accepts `while(1){}` and hangs
 * the tab, accepts `document.cookie` and returns nonsense, and reports a syntax
 * error as a `SyntaxError` about JavaScript rather than about the thing the
 * user typed. A parser that knows the grammar can say *"unknown function 'sn'
 * at 4"* and refuse to evaluate anything it has not been taught.
 *
 * ## What it accepts
 *
 * Infix arithmetic with the usual precedence, right-associative `^`, unary
 * minus, grouping with parentheses, `|x|` for absolute value, a named variable,
 * the constants below, and the functions below — nothing else. Implicit
 * multiplication is supported (`2x`, `3sin(x)`, `2(x+1)`, `x(x+1)`) because
 * that is how the notation is actually written by hand, and requiring `2*x`
 * makes the field feel like a programming language rather than like maths.
 *
 * ## Totality
 *
 * `evaluate` never throws. Division by zero, `log(-1)` and `asin(2)` all
 * produce a non-finite number, which the plotter reads as a **hole** and breaks
 * the curve at — the same `null` a missing reading uses elsewhere in this
 * engine. That is what draws `tan(x)` with gaps at its asymptotes instead of
 * vertical lines through them, which is the single most recognisable way a
 * function plotter is wrong.
 */

export interface CompiledExpression {
  /** The source, as typed. */
  source: string;
  /**
   * Evaluate at the declared variables, positionally.
   *
   * One argument for `f(x)`, two for `F(x, y)` — an implicit curve, a contour,
   * a slope field or a vector component. Positional rather than a record
   * because the caller is a sampling loop running tens of thousands of times
   * per frame, and allocating an object per sample is the difference between a
   * contour that draws and one that stutters.
   *
   * Never throws; may return NaN.
   */
  evaluate(...values: number[]): number;
  /** The free variables this expression may read, in argument order. */
  variables: string[];
  /** The first of them, for the single-variable callers. */
  variableName: string;
}

export interface ExpressionError {
  message: string;
  /** Character offset the parser gave up at, for a caret in the field. */
  position: number;
}

export type ParseResult =
  | { ok: true; expression: CompiledExpression }
  | { ok: false; error: ExpressionError };

/**
 * The functions this language knows.
 *
 * A closed list, deliberately. Anything not here is a parse error naming the
 * unknown function, rather than a silent `NaN` fifty samples into a curve that
 * looks merely wrong.
 */
const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  atan2: Math.atan2,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  exp: Math.exp,
  // `log` is base 10 and `ln` is natural, which is the convention on a
  // calculator and in most maths writing. JavaScript's `Math.log` being the
  // natural one is a fact about JavaScript, not about notation, and following
  // it here would silently give the wrong curve to anybody who typed what they
  // meant.
  log: Math.log10,
  ln: Math.log,
  log2: Math.log2,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sign: Math.sign,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
  mod: (a, b) => a % b,
  // Useful for signal plots, and awkward to write out of the primitives.
  sinc: (x) => (x === 0 ? 1 : Math.sin(x) / x),
  gauss: (x) => Math.exp(-(x * x) / 2) / Math.sqrt(2 * Math.PI),
};

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  PI: Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
  phi: (1 + Math.sqrt(5)) / 2,
};

/** The arities the closed list above expects, for a useful error. */
const ARITY: Record<string, number> = { atan2: 2, min: 2, max: 2, pow: 2, mod: 2 };

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

type Node =
  | { kind: 'num'; value: number }
  | { kind: 'var'; index: number }
  | { kind: 'unary'; op: '-' | '+'; operand: Node }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/' | '%' | '^'; left: Node; right: Node }
  | { kind: 'call'; name: string; args: Node[] }
  | { kind: 'abs'; operand: Node };

function evalNode(node: Node, vars: number[]): number {
  switch (node.kind) {
    case 'num':
      return node.value;
    case 'var':
      return vars[node.index] ?? Number.NaN;
    case 'unary':
      return node.op === '-' ? -evalNode(node.operand, vars) : evalNode(node.operand, vars);
    case 'abs':
      return Math.abs(evalNode(node.operand, vars));
    case 'binary': {
      const a = evalNode(node.left, vars);
      const b = evalNode(node.right, vars);
      switch (node.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        // Not guarded: `1/0` is `Infinity`, which the plotter reads as a hole
        // and breaks the curve at. Guarding it to 0 would draw a line through
        // the asymptote, which is the lie this whole module exists to avoid.
        case '/': return a / b;
        case '%': return a % b;
        case '^': return Math.pow(a, b);
      }
      return Number.NaN;
    }
    case 'call': {
      const fn = FUNCTIONS[node.name];
      if (!fn) return Number.NaN;
      return fn(...node.args.map((a) => evalNode(a, vars)));
    }
  }
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

class Parser {
  private i = 0;
  // Declared rather than written as constructor parameter properties: the
  // build runs with `erasableSyntaxOnly`, which rules out any TypeScript that
  // emits code rather than being stripped.
  private readonly src: string;
  private readonly variables: string[];

  constructor(src: string, variables: string[]) {
    this.src = src;
    this.variables = variables;
  }

  parse(): Node {
    const node = this.expression();
    this.skipSpace();
    if (this.i < this.src.length) {
      this.fail(`Unexpected "${this.src[this.i]}"`);
    }
    return node;
  }

  private fail(message: string): never {
    const err: ExpressionError = { message, position: this.i };
    throw err;
  }

  private skipSpace() {
    while (this.i < this.src.length && /\s/.test(this.src[this.i])) this.i += 1;
  }

  private peek(): string {
    this.skipSpace();
    return this.src[this.i] ?? '';
  }

  private eat(ch: string): boolean {
    if (this.peek() === ch) {
      this.i += 1;
      return true;
    }
    return false;
  }

  private expression(): Node {
    let left = this.term();
    for (;;) {
      const c = this.peek();
      if (c === '+' || c === '-') {
        this.i += 1;
        left = { kind: 'binary', op: c, left, right: this.term() };
      } else return left;
    }
  }

  private term(): Node {
    let left = this.unary();
    for (;;) {
      const c = this.peek();
      if (c === '*' || c === '/' || c === '%') {
        this.i += 1;
        left = { kind: 'binary', op: c, left, right: this.unary() };
      } else if (this.startsImplicitProduct()) {
        // `2x`, `3sin(x)`, `2(x+1)`. Binds at the same level as an explicit
        // `*`, which is what the notation means.
        left = { kind: 'binary', op: '*', left, right: this.unary() };
      } else return left;
    }
  }

  private openPipes = 0;

  /** Whether what follows a complete factor is another factor. */
  private startsImplicitProduct(): boolean {
    const c = this.peek();
    if (c === '|') {
      // If a pipe is currently open, `|` closes it rather than starting a new factor.
      return this.openPipes === 0;
    }
    return c === '(' || /[A-Za-z0-9._]/.test(c);
  }

  private unary(): Node {
    const c = this.peek();
    if (c === '-' || c === '+') {
      this.i += 1;
      return { kind: 'unary', op: c, operand: this.unary() };
    }
    return this.power();
  }

  private power(): Node {
    const base = this.primary();
    if (this.peek() === '^') {
      this.i += 1;
      // Right-associative: 2^3^2 is 2^(3^2), as in every maths notation.
      // Precedence: exponentiation binds tighter than unary negation,
      // so `-x^2` is `-(x^2)` and `2^-3` is `2^(-3)`.
      return { kind: 'binary', op: '^', left: base, right: this.unary() };
    }
    return base;
  }

  private primary(): Node {
    const c = this.peek();

    if (c === '(') {
      this.i += 1;
      const inner = this.expression();
      if (!this.eat(')')) this.fail('Missing ")"');
      return inner;
    }

    if (c === '|') {
      this.i += 1;
      this.openPipes += 1;
      const inner = this.expression();
      if (!this.eat('|')) this.fail('Missing closing "|"');
      this.openPipes -= 1;
      return { kind: 'abs', operand: inner };
    }

    if (/[0-9.]/.test(c)) return this.number();
    if (/[A-Za-z_]/.test(c)) return this.identifier();

    if (c === '') this.fail('Unexpected end of expression');
    this.fail(`Unexpected "${c}"`);
  }

  private number(): Node {
    this.skipSpace();
    const start = this.i;
    while (this.i < this.src.length && /[0-9]/.test(this.src[this.i])) this.i += 1;
    if (this.src[this.i] === '.') {
      this.i += 1;
      while (this.i < this.src.length && /[0-9]/.test(this.src[this.i])) this.i += 1;
    }
    // Scientific notation, so `1e-3` is a number and not `1 * e - 3`.
    if (/[eE]/.test(this.src[this.i] ?? '') && /[0-9+-]/.test(this.src[this.i + 1] ?? '')) {
      this.i += 1;
      if (/[+-]/.test(this.src[this.i])) this.i += 1;
      while (this.i < this.src.length && /[0-9]/.test(this.src[this.i])) this.i += 1;
    }
    const value = Number(this.src.slice(start, this.i));
    if (!Number.isFinite(value)) this.fail('Not a number');
    return { kind: 'num', value };
  }

  private identifier(): Node {
    this.skipSpace();
    const start = this.i;
    while (this.i < this.src.length && /[A-Za-z0-9_]/.test(this.src[this.i])) this.i += 1;
    const name = this.src.slice(start, this.i);

    if (this.peek() === '(') {
      this.i += 1;
      const args: Node[] = [];
      if (this.peek() !== ')') {
        for (;;) {
          args.push(this.expression());
          if (this.eat(',')) continue;
          break;
        }
      }
      if (!this.eat(')')) this.fail(`Missing ")" after ${name}`);

      if (!FUNCTIONS[name]) {
        this.i = start;
        this.fail(`Unknown function "${name}"`);
      }
      const expected = ARITY[name] ?? 1;
      if (args.length !== expected) {
        this.i = start;
        this.fail(`${name} takes ${expected} argument${expected === 1 ? '' : 's'}`);
      }
      return { kind: 'call', name, args };
    }

    const varIndex = this.variables.indexOf(name);
    if (varIndex !== -1) return { kind: 'var', index: varIndex };
    if (name in CONSTANTS) return { kind: 'num', value: CONSTANTS[name] };

    this.i = start;
    this.fail(`Unknown name "${name}"`);
  }
}

/**
 * Compile an expression, or say why it cannot be compiled.
 *
 * Returns a result rather than throwing, because the caller is a text field
 * that has to keep showing the last good curve while somebody is halfway
 * through typing the next one. Throwing would make "in progress" and "wrong"
 * the same event.
 */
export function parseExpression(
  source: string,
  variable: string | string[] = 'x'
): ParseResult {
  const variables = Array.isArray(variable) ? variable : [variable];
  const trimmed = source.trim();
  if (!trimmed) return { ok: false, error: { message: 'Empty expression', position: 0 } };

  try {
    const node = new Parser(trimmed, variables).parse();
    // Reused across calls so a sampling loop allocates nothing per sample: a
    // contour grid evaluates this a hundred thousand times for one frame.
    const slot: number[] = [];
    return {
      ok: true,
      expression: {
        source: trimmed,
        variables,
        variableName: variables[0],
        evaluate: (...values: number[]) => {
          slot.length = 0;
          for (let i = 0; i < values.length; i += 1) slot.push(values[i]);
          const v = evalNode(node, slot);
          return typeof v === 'number' ? v : Number.NaN;
        },
      },
    };
  } catch (e) {
    const err = e as ExpressionError;
    return {
      ok: false,
      error:
        typeof err?.message === 'string'
          ? { message: err.message, position: err.position ?? 0 }
          : { message: 'Could not read that expression', position: 0 },
    };
  }
}

/** The names the editor can offer, so the list is never a second copy. */
export const EXPRESSION_FUNCTIONS = Object.keys(FUNCTIONS).sort();
export const EXPRESSION_CONSTANTS = Object.keys(CONSTANTS).filter((k) => k !== 'PI').sort();
