-- المرحلة 4: المحتوى (المستويات والدورات، والمقاطع، والدروس).
-- كل الأوقات بالمللي ثانية منذ 1970 (Date.now()).

-- المستويات الخمسة ثابتة (يرتبط بها مستوى كل ابن)، والدورات يضيفها الأستاذ.
CREATE TABLE programs (
  slug TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('level', 'course')),
  title TEXT NOT NULL,
  short TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'level',
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO programs (slug, kind, title, short, icon, position, created_at, updated_at) VALUES
  ('1am', 'level', 'السنة الأولى متوسط', '1 متوسط', 'level', 1, 0, 0),
  ('2am', 'level', 'السنة الثانية متوسط', '2 متوسط', 'level', 2, 0, 0),
  ('3am', 'level', 'السنة الثالثة متوسط', '3 متوسط', 'level', 3, 0, 0),
  ('4am', 'level', 'السنة الرابعة متوسط', '4 متوسط', 'level', 4, 0, 0),
  ('1as', 'level', 'السنة الأولى ثانوي', '1 ثانوي', 'level', 5, 0, 0),
  ('mental-math', 'course', 'الحساب الذهني', 'دورة', 'calculator', 6, 0, 0),
  ('olympiad', 'course', 'تحضير الأولمبياد', 'دورة', 'trophy', 7, 0, 0);

-- المقطع (في المستوى) أو الجزء (في الدورة).
-- المسودة لا تظهر لأحد غير الأستاذ. playlist_id: قائمة تشغيل يوتيوب المرتبطة بالمقطع، إن وُجدت.
CREATE TABLE units (
  id INTEGER PRIMARY KEY,
  program_slug TEXT NOT NULL REFERENCES programs(slug) ON DELETE CASCADE,
  title TEXT NOT NULL,
  position INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  playlist_id TEXT,
  playlist_synced_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX units_by_program ON units(program_slug, position);

-- الدرس: فيديو يوتيوب، أو ملف PDF.
-- free = 1: مفتوح للجميع. youtube_id لا يُرسل أبدًا إلى من لا يحق له مشاهدة الدرس.
CREATE TABLE lessons (
  id INTEGER PRIMARY KEY,
  unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('video', 'pdf')),
  title TEXT NOT NULL,
  description TEXT,
  position INTEGER NOT NULL,
  free INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  youtube_id TEXT,
  -- ملف PDF في مخزن R2: مفتاحه، واسمه الأصلي، وحجمه، وطريقة إتاحته
  file_key TEXT,
  file_name TEXT,
  file_size INTEGER,
  file_mode TEXT CHECK (file_mode IN ('view', 'download', 'both')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK ((kind = 'video' AND youtube_id IS NOT NULL) OR (kind = 'pdf' AND file_key IS NOT NULL))
);
CREATE INDEX lessons_by_unit ON lessons(unit_id, position);
-- نفس الفيديو لا يتكرر في نفس المقطع (مهم عند تحديث قائمة التشغيل)
CREATE UNIQUE INDEX lessons_video_once ON lessons(unit_id, youtube_id) WHERE youtube_id IS NOT NULL;
