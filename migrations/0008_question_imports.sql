-- المرحلة 6.5: استيراد الأسئلة من Excel. المعاينة تُحفظ هنا حتى يؤكد الأستاذ أو يلغي، وتُحذف بعد يوم.
-- items: الأسئلة الصالحة (JSON)، problems: الصفوف المرفوضة مع السبب (JSON).
CREATE TABLE question_imports (
  id INTEGER PRIMARY KEY,
  quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  file_name TEXT,
  items TEXT NOT NULL,
  problems TEXT NOT NULL,
  created_by INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX question_imports_by_time ON question_imports(created_at);
