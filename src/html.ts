// أدوات بناء صفحات HTML بأمان.
// كل قيمة تُدرج في القالب تُهرَّب تلقائيًا، فلا يمكن لنص يكتبه مستخدم أن يتحول إلى كود.

export class Raw {
  value: string;
  constructor(value: string) {
    this.value = value;
  }
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

function render(value: unknown): string {
  if (value instanceof Raw) return value.value;
  if (Array.isArray(value)) return value.map(render).join("");
  if (value === null || value === undefined || value === false) return "";
  return esc(String(value));
}

/** قالب HTML: القيم المدرجة تُهرَّب، إلا ما أُنتج بنفس القالب. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): Raw {
  let out = strings[0] ?? "";
  values.forEach((value, i) => {
    out += render(value) + (strings[i + 1] ?? "");
  });
  return new Raw(out);
}
