-- المرحلة 5: الاشتراكات والإعدادات.
-- كل الأوقات بالمللي ثانية منذ 1970 (Date.now()).

-- إعدادات يكتبها الأستاذ من لوحة التحكم: تواريخ نهاية الفصول، ورقم واتساب، ومعلومات الدفع، والأسعار.
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- اشتراك ابن في مستوى أو دورة. الدفع خارج المنصة، والأستاذ يفعّل يدويًا.
-- kind: term1 / term2 / term3 / year للمستويات، وcourse للدورات (سنة من التفعيل).
CREATE TABLE subscriptions (
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  program_slug TEXT NOT NULL REFERENCES programs(slug) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('term1', 'term2', 'term3', 'year', 'course')),
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  note TEXT,
  created_by INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  CHECK (ends_at > starts_at)
);
CREATE INDEX subscriptions_by_student ON subscriptions(student_id, program_slug);
CREATE INDEX subscriptions_by_end ON subscriptions(ends_at);

-- أول تاريخ نشر للدرس وللمقطع: بعد انتهاء الاشتراك يبقى مفتوحًا سنةً ما نُشر قبل نهايته فقط.
ALTER TABLE lessons ADD COLUMN published_at INTEGER;
ALTER TABLE units ADD COLUMN published_at INTEGER;
UPDATE lessons SET published_at = updated_at WHERE status = 'published';
UPDATE units SET published_at = updated_at WHERE status = 'published';
