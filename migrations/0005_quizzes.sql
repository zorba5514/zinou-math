-- المرحلة 6: الفروض والاختبارات.
-- كل الأوقات بالمللي ثانية منذ 1970 (Date.now()).

-- إعدادات الاختبار. الاختبار يظهر في المقطع كدرس من نوع quiz (عنوانه ومجانيته ونشره في جدول الدروس).
-- results: immediate = العلامة والإجابات الصحيحة فور التسليم، score = العلامة فقط،
--          released = لا شيء حتى ينشر الأستاذ النتائج (results_released = 1).
CREATE TABLE quizzes (
  id INTEGER PRIMARY KEY,
  instructions TEXT,
  time_limit INTEGER,
  max_attempts INTEGER,
  shuffle_questions INTEGER NOT NULL DEFAULT 0,
  shuffle_choices INTEGER NOT NULL DEFAULT 0,
  results TEXT NOT NULL DEFAULT 'immediate' CHECK (results IN ('immediate', 'score', 'released')),
  results_released INTEGER NOT NULL DEFAULT 0,
  allow_upload INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (time_limit IS NULL OR time_limit BETWEEN 1 AND 600),
  CHECK (max_attempts IS NULL OR max_attempts BETWEEN 1 AND 50)
);

-- السؤال. data بصيغة JSON حسب النوع: الاختيارات والإجابة الصحيحة، أو القيمة وهامش الخطأ، أو الإجابات المقبولة.
CREATE TABLE questions (
  id INTEGER PRIMARY KEY,
  quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('single', 'multiple', 'truefalse', 'numeric', 'short', 'open')),
  text TEXT NOT NULL,
  points REAL NOT NULL DEFAULT 1 CHECK (points > 0 AND points <= 100),
  data TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX questions_by_quiz ON questions(quiz_id, position);

-- محاولة تلميذ. deadline_at يحسبه الخادم عند البدء. layout: ترتيب الأسئلة والاختيارات لهذه المحاولة.
-- status: in_progress أثناء الاجتياز، submitted بانتظار تصحيح الأستاذ، graded مصحَّحة كليًا.
CREATE TABLE attempts (
  id INTEGER PRIMARY KEY,
  quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  deadline_at INTEGER,
  submitted_at INTEGER,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted', 'graded')),
  score REAL,
  max_score REAL,
  layout TEXT NOT NULL DEFAULT '{}',
  upload_key TEXT,
  upload_name TEXT,
  upload_size INTEGER,
  feedback TEXT,
  graded_at INTEGER
);
CREATE INDEX attempts_by_student ON attempts(student_id, quiz_id);
CREATE INDEX attempts_by_quiz ON attempts(quiz_id, status);

-- إجابة سؤال في محاولة. auto_score من التصحيح الآلي، manual_score من الأستاذ (يغلب إن وُجد).
CREATE TABLE answers (
  attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  value TEXT NOT NULL DEFAULT '',
  auto_score REAL,
  manual_score REAL,
  feedback TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (attempt_id, question_id)
);

-- الدروس: نوع جديد quiz يشير إلى الاختبار. SQLite لا يغيّر شرط CHECK، فيُعاد بناء الجدول بنفس البيانات.
PRAGMA defer_foreign_keys = true;

CREATE TABLE lessons_new (
  id INTEGER PRIMARY KEY,
  unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('video', 'pdf', 'quiz')),
  title TEXT NOT NULL,
  description TEXT,
  position INTEGER NOT NULL,
  free INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  youtube_id TEXT,
  file_key TEXT,
  file_name TEXT,
  file_size INTEGER,
  file_mode TEXT CHECK (file_mode IN ('view', 'download', 'both')),
  quiz_id INTEGER REFERENCES quizzes(id) ON DELETE CASCADE,
  published_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (
    (kind = 'video' AND youtube_id IS NOT NULL)
    OR (kind = 'pdf' AND file_key IS NOT NULL)
    OR (kind = 'quiz' AND quiz_id IS NOT NULL)
  )
);

INSERT INTO lessons_new (id, unit_id, kind, title, description, position, free, status, youtube_id, file_key, file_name, file_size, file_mode, published_at, created_at, updated_at)
  SELECT id, unit_id, kind, title, description, position, free, status, youtube_id, file_key, file_name, file_size, file_mode, published_at, created_at, updated_at FROM lessons;

DROP TABLE lessons;
ALTER TABLE lessons_new RENAME TO lessons;

CREATE INDEX lessons_by_unit ON lessons(unit_id, position);
CREATE UNIQUE INDEX lessons_video_once ON lessons(unit_id, youtube_id) WHERE youtube_id IS NOT NULL;
CREATE UNIQUE INDEX lessons_quiz_once ON lessons(quiz_id) WHERE quiz_id IS NOT NULL;
