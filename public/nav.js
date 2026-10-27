// إحساس فوري عند الضغط: شريط تحميل في أعلى الصفحة لحظة الضغط على رابط أو زر نموذج،
// وزر النموذج يُظهر أنه يعمل ولا يُضغط مرتين. الصفحة تعمل كما هي بدون هذا الملف.

const bar = document.createElement("div");
bar.className = "nav-progress";
bar.setAttribute("aria-hidden", "true");
document.body.append(bar);

function start() {
  bar.classList.remove("run");
  void bar.offsetWidth;
  bar.classList.add("run");
}

function stop() {
  bar.classList.remove("run");
  for (const b of document.querySelectorAll(".is-busy")) {
    b.classList.remove("is-busy");
    b.disabled = false;
  }
}

document.addEventListener("click", (event) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target.closest("a[href]");
  if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
  const url = new URL(link.href, location.href);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/files/") || url.pathname.endsWith("/upload")) return;
  if (url.pathname === location.pathname && url.search === location.search && url.hash) return;
  start();
});

document.addEventListener("submit", (event) => {
  if (event.defaultPrevented) return;
  const button = event.submitter;
  if (button && button.tagName === "BUTTON") {
    button.classList.add("is-busy");
    // التعطيل بعد لحظة حتى تُرسل قيمة الزر مع النموذج
    setTimeout(() => (button.disabled = true), 0);
  }
  start();
});

// العودة بزر الرجوع تُظهر الصفحة من الذاكرة: نزيل حالة التحميل
addEventListener("pageshow", stop);
