// تفاعل المتصفح: تحريك الرسم البياني في الصفحة الرئيسية.
import { describe, formula, intercept, linePath, num, toY } from "/graph.js";

for (const figure of document.querySelectorAll("[data-graph]")) {
  const a = figure.querySelector("[data-a]");
  const b = figure.querySelector("[data-b]");
  const line = figure.querySelector("[data-line]");
  const point = figure.querySelector("[data-point]");
  const svg = figure.querySelector("svg");
  const outA = figure.querySelector("[data-out-a]");
  const outB = figure.querySelector("[data-out-b]");
  const formulaText = figure.querySelector("[data-formula]");
  const note = figure.querySelector("[data-note]");
  const point2 = figure.querySelector("[data-intercept]");
  const controls = figure.querySelector("[data-controls]");
  if (!a || !b || !line || !point || !svg || !controls) continue;

  const update = () => {
    const av = Number(a.value);
    const bv = Number(b.value);
    const f = formula(av, bv);
    line.setAttribute("d", linePath(av, bv));
    point.setAttribute("cy", String(toY(bv)));
    svg.setAttribute("aria-label", `رسم المستقيم ${f}`);
    if (outA) outA.textContent = num(av);
    if (outB) outB.textContent = num(bv);
    if (formulaText) formulaText.textContent = f;
    if (note) note.textContent = describe(av);
    if (point2) point2.textContent = intercept(bv);
  };

  a.addEventListener("input", update);
  b.addEventListener("input", update);
  controls.hidden = false;
  figure.classList.add("is-live");
}
