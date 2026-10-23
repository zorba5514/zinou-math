// حسابات الرسم التفاعلي للدالة f(x) = ax + b.
// ملف واحد يستعمله الخادم (لرسم الحالة الأولى) والمتصفح (عند تحريك المؤشرين).

export const SIZE = 320;
export const UNIT = 20;
export const RANGE = 8;

const MINUS = "−";

/** يحوّل فاصلة رياضية إلى إحداثي في الرسم. */
export function toX(x) {
  return SIZE / 2 + UNIT * x;
}

/** يحوّل ترتيبة رياضية إلى إحداثي في الرسم (المحور يتجه إلى الأعلى). */
export function toY(y) {
  return SIZE / 2 - UNIT * y;
}

/** عدد مكتوب بعلامة الطرح الرياضية. */
export function num(n) {
  const text = String(Object.is(n, -0) ? 0 : n);
  return text.replace("-", MINUS);
}

/** نص الدالة، مثل f(x) = 2x − 3 */
export function formula(a, b) {
  let ax = "";
  if (a === 1) ax = "x";
  else if (a === -1) ax = `${MINUS}x`;
  else if (a !== 0) ax = `${num(a)}x`;
  let bs = "";
  if (b !== 0) bs = ax ? (b > 0 ? ` + ${num(b)}` : ` ${MINUS} ${num(-b)}`) : num(b);
  return `f(x) = ${ax + bs || "0"}`;
}

/** مسار المستقيم داخل مربع الرسم. */
export function linePath(a, b) {
  const x1 = toX(-RANGE);
  const y1 = toY(a * -RANGE + b);
  const x2 = toX(RANGE);
  const y2 = toY(a * RANGE + b);
  return `M${x1} ${y1}L${x2} ${y2}`;
}

/** جملة تشرح اتجاه المستقيم (بدون رموز لاتينية بين قوسين، حتى لا ينقلب ترتيبها في النص العربي). */
export function describe(a) {
  if (a > 0) return "المستقيم صاعد: كلما زادت x زادت قيمة الدالة.";
  if (a < 0) return "المستقيم نازل: كلما زادت x نقصت قيمة الدالة.";
  return "المستقيم أفقي: الدالة ثابتة.";
}

/** نقطة تقاطع المستقيم مع محور التراتيب، تُكتب من اليسار إلى اليمين. */
export function intercept(b) {
  return `(0 ; ${num(b)})`;
}
