// أزرار النسخ في لوحة التحكم: تظهر فقط إذا كان المتصفح يدعم النسخ.
for (const button of document.querySelectorAll("[data-copy]")) {
  const source = document.querySelector(`[data-copy-source="${button.dataset.copy}"]`);
  if (!source || !navigator.clipboard) continue;
  const label = button.querySelector("span");
  const original = label ? label.textContent : "";
  button.hidden = false;
  button.addEventListener("click", async () => {
    const text = source.matches("ul")
      ? [...source.querySelectorAll("li")].map((li) => li.textContent.trim()).join("\n")
      : source.textContent.trim();
    try {
      await navigator.clipboard.writeText(text);
      if (label) label.textContent = "تم النسخ";
    } catch {
      if (label) label.textContent = "تعذّر النسخ: انسخ يدويًا";
    }
    setTimeout(() => {
      if (label) label.textContent = original;
    }, 2500);
  });
}
