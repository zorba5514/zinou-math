// الكتابة الرياضية في نصوص الأسئلة: ما بين علامتي $ يُعرض كصيغة رياضية بـ KaTeX في الخادم،
// والباقي نص عادي يُهرَّب. مثال: «احسب $\frac{3}{4}+\frac{1}{2}$ ثم بسّط».
// $$...$$ تعرض الصيغة في سطر مستقل. لكتابة علامة الدولار نفسها: \$

import katex from "katex";
import { Raw, esc } from "./html.ts";
import { parse, toLatex } from "../public/mathexpr.js";

/** صيغة LaTeX واحدة إلى HTML. الصيغة الخاطئة تُعرض كنص أحمر بدل أن تُعطل الصفحة. */
export function renderTex(tex: string, display = false): string {
  return katex.renderToString(tex, {
    throwOnError: false,
    displayMode: display,
    output: "htmlAndMathml",
    // حماية: لا أوامر تنشئ روابط أو تنسيقًا خارجيًا
    trust: false,
    strict: "ignore",
    maxSize: 10,
    maxExpand: 200,
  });
}

/** نص فيه صيغ بين $...$ إلى HTML آمن. */
export function mathText(text: string): Raw {
  let out = "";
  let i = 0;
  let plain = "";
  const flush = () => {
    out += esc(plain).replace(/\n/g, "<br>");
    plain = "";
  };
  while (i < text.length) {
    if (text[i] === "\\" && text[i + 1] === "$") {
      plain += "$";
      i += 2;
      continue;
    }
    if (text[i] === "$") {
      const display = text[i + 1] === "$";
      const open = display ? 2 : 1;
      const end = text.indexOf(display ? "$$" : "$", i + open);
      if (end > i + open - 1 && end !== -1) {
        flush();
        out += `<span class="math${display ? " math-display" : ""}" dir="ltr">${renderTex(text.slice(i + open, end), display)}</span>`;
        i = end + open;
        continue;
      }
    }
    plain += text[i];
    i++;
  }
  flush();
  return new Raw(out);
}

/** هل في النص صيغة رياضية؟ (لتحميل تنسيق KaTeX فقط عند الحاجة) */
export function hasMath(text: string): boolean {
  return /\$[^$]+\$/.test(text);
}

/** إجابة التلميذ (عبارة) معروضة كصيغة، أو كنص عادي إن لم تُقرأ. */
export function answerMath(input: string): Raw {
  const p = parse(input);
  if (!p.ok) return new Raw(`<bdi dir="ltr">${esc(input)}</bdi>`);
  return new Raw(`<span class="math" dir="ltr">${renderTex(toLatex(p.ast))}</span>`);
}
