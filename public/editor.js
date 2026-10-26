// محرر الأسئلة في لوحة التحكم: أزرار الكتابة الرياضية، ومعاينة الصيغ أثناء الكتابة.
// الصيغ تُكتب بين علامتي $ (مثل $\frac{3}{4}$)، والأزرار تُدرجها في مكان المؤشر.

const katex = globalThis.katex;

/** يعرض نصًا فيه صيغ بين $...$ داخل عنصر المعاينة. */
function renderPreview(target, text) {
  target.textContent = "";
  if (!katex || !text.includes("$")) {
    target.hidden = true;
    return;
  }
  target.hidden = false;
  const parts = text.split(/(\$\$[^$]+\$\$|\$[^$]+\$)/g);
  for (const part of parts) {
    if (!part) continue;
    const display = part.startsWith("$$");
    if (part.startsWith("$") && part.endsWith("$") && part.length > 2) {
      const span = document.createElement("span");
      span.dir = "ltr";
      span.className = "math";
      katex.render(part.slice(display ? 2 : 1, display ? -2 : -1), span, { throwOnError: false, displayMode: display, strict: "ignore", trust: false });
      target.append(span);
    } else {
      target.append(document.createTextNode(part));
    }
  }
}

const inputs = [...document.querySelectorAll("[data-math-input]")];
let last = inputs[0] ?? null;

for (const el of inputs) {
  const preview = document.querySelector(`[data-math-preview="${el.name}"]`);
  const update = () => preview && renderPreview(preview, el.value);
  el.addEventListener("input", update);
  el.addEventListener("focus", () => (last = el));
  update();
}

/** هل المؤشر داخل صيغة (عدد علامات $ قبله فردي)؟ */
function insideMath(text, pos) {
  const before = text.slice(0, pos).replace(/\\\$/g, "");
  return (before.match(/\$/g) ?? []).length % 2 === 1;
}

const toolbar = document.querySelector("[data-math-toolbar]");
if (toolbar && inputs.length) {
  toolbar.hidden = false;
  toolbar.addEventListener("click", (event) => {
    const button = event.target.closest("[data-insert]");
    if (!button || !last) return;
    const el = last;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const selected = el.value.slice(start, end);
    let snippet = button.dataset.insert;
    // ما حدده الأستاذ يدخل في أول خانة فارغة (مثل البسط)
    if (selected) snippet = snippet.replace("□", selected);
    const wrap = !insideMath(el.value, start);
    const text = wrap ? `$${snippet}$` : snippet;
    const cursor = text.indexOf("□");
    const clean = text.replace(/□/g, "");
    el.setRangeText(clean, start, end, "end");
    const pos = start + (cursor >= 0 ? cursor : clean.length - (wrap ? 1 : 0));
    el.focus();
    el.setSelectionRange(pos, pos);
    el.dispatchEvent(new Event("input"));
  });
}
