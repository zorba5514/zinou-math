// العبارات الرياضية التي يكتبها التلميذ: قراءتها، وحساب قيمتها، وعرضها، ومقارنة عبارتين.
// ملف واحد يستعمله الخادم (للتصحيح) والمتصفح (للمعاينة أثناء الكتابة).
//
// أمثلة مقبولة: 3/4   0,75   -2   √2   √(x+1)   2x+3   (x+1)^2   x²   2π   3×4   6÷2
// المقارنة: عبارتان متساويتان إذا أعطتا نفس القيمة عند عدة قيم للمتغيرات،
// فتُقبل 2x+3 و3+2x و(4x+6)/2 كإجابة واحدة.

const MAX_LENGTH = 200;
const MAX_DEPTH = 40;

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** يوحّد الرموز: الأرقام العربية، وعلامات الضرب والقسمة والطرح، والأسس الصغيرة. */
export function normalizeInput(text) {
  return String(text)
    .slice(0, MAX_LENGTH)
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)))
    .replace(/[×·∗⋅]/g, "*")
    .replace(/[÷:]/g, "/")
    .replace(/[−–—]/g, "-")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/\s+/g, "");
}

function tokenize(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const num = /^\d+(?:[.,]\d+)?/.exec(text.slice(i));
    if (num) {
      tokens.push({ t: "num", v: Number(num[0].replace(",", ".")) });
      i += num[0].length;
    } else if (/[a-zA-Z]/.test(c)) {
      tokens.push({ t: "var", n: c.toLowerCase() });
      i++;
    } else if (c === "π") {
      tokens.push({ t: "num", v: Math.PI, pi: true });
      i++;
    } else if ("+-*/^()√".includes(c)) {
      tokens.push({ t: c });
      i++;
    } else {
      throw new Error(`رمز غير معروف: ${c}`);
    }
  }
  return tokens;
}

/** يقرأ العبارة. يُرجع { ok: true, ast } أو { ok: false, error }. */
export function parse(input) {
  let tokens;
  try {
    tokens = tokenize(normalizeInput(input));
  } catch (e) {
    return { ok: false, error: e.message };
  }
  if (!tokens.length) return { ok: false, error: "الإجابة فارغة" };
  let pos = 0;
  let depth = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const startsPrimary = (tok) => tok && (tok.t === "num" || tok.t === "var" || tok.t === "(" || tok.t === "√");

  function deeper() {
    if (++depth > MAX_DEPTH) throw new Error("العبارة طويلة جدًا");
  }

  function expr() {
    deeper();
    let left = term();
    while (peek() && (peek().t === "+" || peek().t === "-")) {
      const op = next().t;
      left = { t: op === "+" ? "add" : "sub", a: left, b: term() };
    }
    depth--;
    return left;
  }

  function term() {
    let left = unary();
    for (;;) {
      const tok = peek();
      if (tok && (tok.t === "*" || tok.t === "/")) {
        next();
        left = { t: tok.t === "*" ? "mul" : "div", a: left, b: unary() };
      } else if (startsPrimary(tok)) {
        // ضرب ضمني: 2x ، 3(x+1) ، x(x-1)
        left = { t: "mul", a: left, b: power(), implicit: true };
      } else break;
    }
    return left;
  }

  function unary() {
    const tok = peek();
    if (tok && (tok.t === "-" || tok.t === "+")) {
      next();
      deeper();
      const a = unary();
      depth--;
      return tok.t === "-" ? { t: "neg", a } : a;
    }
    return power();
  }

  function power() {
    const base = primary();
    if (peek() && peek().t === "^") {
      next();
      deeper();
      const exp = unary();
      depth--;
      return { t: "pow", a: base, b: exp };
    }
    return base;
  }

  function primary() {
    const tok = next();
    if (!tok) throw new Error("العبارة ناقصة");
    if (tok.t === "num") return tok.pi ? { t: "pi" } : { t: "num", v: tok.v };
    if (tok.t === "var") return { t: "var", n: tok.n };
    if (tok.t === "(") {
      const inner = expr();
      if (!peek() || peek().t !== ")") throw new Error("قوس غير مغلق");
      next();
      return { t: "group", a: inner };
    }
    if (tok.t === "√") {
      deeper();
      const a = power();
      depth--;
      return { t: "sqrt", a };
    }
    throw new Error("العبارة غير مكتملة");
  }

  try {
    const ast = expr();
    if (pos < tokens.length) throw new Error(tokens[pos].t === ")" ? "قوس زائد" : "العبارة غير صحيحة");
    return { ok: true, ast };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** قيمة العبارة لقيم معطاة للمتغيرات. */
export function evaluate(ast, vars = {}) {
  switch (ast.t) {
    case "num":
      return ast.v;
    case "pi":
      return Math.PI;
    case "var":
      return ast.n in vars ? vars[ast.n] : NaN;
    case "group":
      return evaluate(ast.a, vars);
    case "neg":
      return -evaluate(ast.a, vars);
    case "add":
      return evaluate(ast.a, vars) + evaluate(ast.b, vars);
    case "sub":
      return evaluate(ast.a, vars) - evaluate(ast.b, vars);
    case "mul":
      return evaluate(ast.a, vars) * evaluate(ast.b, vars);
    case "div":
      return evaluate(ast.a, vars) / evaluate(ast.b, vars);
    case "pow":
      return Math.pow(evaluate(ast.a, vars), evaluate(ast.b, vars));
    case "sqrt":
      return Math.sqrt(evaluate(ast.a, vars));
    default:
      return NaN;
  }
}

/** أسماء المتغيرات في العبارة. */
export function variables(ast, out = new Set()) {
  if (ast.t === "var") out.add(ast.n);
  if (ast.a) variables(ast.a, out);
  if (ast.b) variables(ast.b, out);
  return out;
}

function numLatex(v) {
  const s = String(Math.round(v * 1e12) / 1e12);
  return s.replace(".", "{,}");
}

const PREC = { add: 1, sub: 1, mul: 2, div: 3, neg: 2, pow: 4 };

/** العبارة بصيغة LaTeX لعرضها بـ KaTeX. */
export function toLatex(ast) {
  const wrap = (child, min) => {
    const p = PREC[child.t];
    const s = toLatex(child);
    return p !== undefined && p < min ? `\\left(${s}\\right)` : s;
  };
  switch (ast.t) {
    case "num":
      return numLatex(ast.v);
    case "pi":
      return "\\pi";
    case "var":
      return ast.n;
    case "group":
      return `\\left(${toLatex(ast.a)}\\right)`;
    case "neg":
      return `-${wrap(ast.a, 2)}`;
    case "add":
      return `${toLatex(ast.a)}+${wrap(ast.b, 1)}`;
    case "sub":
      return `${toLatex(ast.a)}-${wrap(ast.b, 2)}`;
    case "mul": {
      const a = wrap(ast.a, 2);
      const b = wrap(ast.b, 2);
      // 2x و3(x+1) تُكتب متجاورة، و3×4 بعلامة الضرب
      const numberNext = ast.b.t === "num" || ast.b.t === "neg" || (ast.b.t === "pow" && ast.b.a.t === "num");
      return ast.implicit && !numberNext ? `${a}${b}` : `${a}\\times ${b}`;
    }
    case "div":
      return `\\frac{${toLatex(strip(ast.a))}}{${toLatex(strip(ast.b))}}`;
    case "pow":
      return `${wrap(ast.a, 5)}^{${toLatex(strip(ast.b))}}`;
    case "sqrt":
      return `\\sqrt{${toLatex(strip(ast.a))}}`;
    default:
      return "";
  }
}

/** القوس حول البسط أو المقام أو الأس لا داعي لعرضه. */
function strip(ast) {
  return ast.t === "group" ? ast.a : ast;
}

function close(a, b) {
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

const POINTS = [0.37, 1.91, -2.43, 3.17, -0.71, 2.59, 4.13, -1.29];

/**
 * هل العبارتان متساويتان؟ تُحسبان عند 8 مجموعات من القيم للمتغيرات.
 * تكفي 3 نقاط صالحة (القسمة على صفر أو جذر سالب يُتجاهل) بشرط ألا تختلفا في أي نقطة.
 */
export function equivalent(a, b) {
  const pa = typeof a === "string" ? parse(a) : { ok: true, ast: a };
  const pb = typeof b === "string" ? parse(b) : { ok: true, ast: b };
  if (!pa.ok || !pb.ok) return false;
  const names = [...new Set([...variables(pa.ast), ...variables(pb.ast)])].sort();
  if (!names.length) {
    const x = evaluate(pa.ast);
    const y = evaluate(pb.ast);
    return Number.isFinite(x) && Number.isFinite(y) && close(x, y);
  }
  let valid = 0;
  for (const base of POINTS) {
    const vars = {};
    names.forEach((n, i) => (vars[n] = base + i * 0.53));
    const x = evaluate(pa.ast, vars);
    const y = evaluate(pb.ast, vars);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (!close(x, y)) return false;
    valid++;
  }
  return valid >= 3;
}

/**
 * قيمة إجابة رقمية: تقبل 3/4 و0,75 و√2 و2π، وتقبل «x = 3» بحذف «x =».
 * null إن لم تكن عددًا.
 */
export function numericValue(input) {
  const text = normalizeInput(input).replace(/^[a-zA-Z]=/, "");
  const p = parse(text);
  if (!p.ok || variables(p.ast).size) return null;
  const v = evaluate(p.ast);
  return Number.isFinite(v) ? v : null;
}
