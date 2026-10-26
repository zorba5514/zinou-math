// صفحة اجتياز الاختبار: حفظ الإجابات أولًا بأول، والمؤقت، ولوحة الأزرار الرياضية مع المعاينة.
// كل شيء يعمل بدون هذا الملف أيضًا: النموذج يُسلَّم كاملًا عند الضغط على «تسليم».

import { parse, toLatex } from "/mathexpr.js";

const form = document.querySelector("[data-attempt]");
const katex = globalThis.katex;

if (form) {
  const attemptId = form.dataset.attempt;
  const saveState = document.querySelector("[data-save-state]");
  const unanswered = document.querySelector("[data-unanswered]");
  let submitting = false;

  // ---------- قيمة كل سؤال ----------

  function valueOf(card) {
    const type = card.dataset.qtype;
    const name = `q_${card.dataset.qid}`;
    if (type === "multiple") {
      return [...card.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value).join(",");
    }
    if (type === "single" || type === "truefalse") {
      return card.querySelector(`input[name="${name}"]:checked`)?.value ?? "";
    }
    return card.querySelector(`[name="${name}"]`)?.value ?? "";
  }

  function countUnanswered() {
    if (!unanswered) return;
    const n = [...form.querySelectorAll("[data-qid]")].filter((card) => !valueOf(card).trim()).length;
    unanswered.textContent = n ? `لم تُجب بعد عن ${n === 1 ? "سؤال واحد" : n === 2 ? "سؤالين" : `${n} أسئلة`}.` : "أجبت عن كل الأسئلة.";
  }

  // ---------- الحفظ ----------

  const timers = new Map();
  let pending = 0;

  function setState(text) {
    if (saveState) saveState.textContent = text;
  }

  async function save(card) {
    const body = new FormData();
    body.set("question_id", card.dataset.qid);
    body.set("value", valueOf(card));
    pending++;
    setState("يُحفظ…");
    try {
      const res = await fetch(`/attempts/${attemptId}/save`, { method: "POST", body });
      if (res.status === 409) {
        // انتهى الوقت: الخادم أغلق المحاولة
        if (!submitting) location.href = `/attempts/${attemptId}`;
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      setState(--pending ? "يُحفظ…" : "حُفظت إجاباتك");
    } catch {
      pending--;
      setState("تعذّر الحفظ. تحقق من الاتصال؛ إجاباتك تُرسل كلها عند التسليم.");
    }
  }

  function schedule(card, delay) {
    clearTimeout(timers.get(card));
    timers.set(card, setTimeout(() => save(card), delay));
  }

  form.addEventListener("change", (event) => {
    const card = event.target.closest("[data-qid]");
    if (card && event.target.type !== "file") schedule(card, 0);
    countUnanswered();
  });
  form.addEventListener("input", (event) => {
    const card = event.target.closest("[data-qid]");
    if (card && (event.target.tagName === "TEXTAREA" || event.target.type === "text" || event.target.dataset.expr !== undefined)) schedule(card, 800);
    countUnanswered();
  });
  form.addEventListener("submit", (event) => {
    if (submitting) {
      event.preventDefault();
      return;
    }
    submitting = true;
    const button = form.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
  });
  countUnanswered();

  // ---------- المؤقت ----------

  const timer = document.querySelector("[data-deadline]");
  if (timer) {
    const deadline = Number(timer.dataset.deadline);
    const offset = Number(timer.dataset.now) - Date.now();
    const text = timer.querySelector("[data-timer-text]");
    const tick = () => {
      const left = Math.max(0, deadline - (Date.now() + offset));
      const m = Math.floor(left / 60000);
      const s = Math.floor((left % 60000) / 1000);
      text.textContent = `${m}:${String(s).padStart(2, "0")}`;
      timer.classList.toggle("timer-warn", left <= 60000);
      if (left <= 0) {
        clearInterval(id);
        if (!submitting) form.requestSubmit();
      }
    };
    const id = setInterval(tick, 1000);
    tick();
  }

  // ---------- لوحة الأزرار والمعاينة ----------

  for (const field of form.querySelectorAll(".expr-field")) {
    const input = field.querySelector("[data-expr]");
    const keypad = field.querySelector("[data-keypad]");
    const preview = field.querySelector("[data-expr-preview]");
    const render = () => {
      preview.textContent = "";
      const value = input.value.trim();
      if (!value) return;
      const p = parse(value);
      if (!p.ok) {
        preview.textContent = p.error;
        preview.classList.add("preview-error");
        return;
      }
      preview.classList.remove("preview-error");
      if (katex) katex.render(toLatex(p.ast), preview, { throwOnError: false });
      else preview.textContent = value;
    };
    keypad.hidden = false;
    keypad.addEventListener("click", (event) => {
      const key = event.target.closest("[data-key]")?.dataset.key;
      if (!key) return;
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? start;
      if (key === "⌫") {
        const from = start === end ? Math.max(0, start - 1) : start;
        input.setRangeText("", from, end, "end");
      } else {
        input.setRangeText(key, start, end, "end");
      }
      input.focus();
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    input.addEventListener("input", render);
    render();
  }
}
