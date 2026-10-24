-- المرحلة 3: الأجهزة المعتمدة وملفات الأبناء والرموز السرية.

-- الجلسات مؤقتة بطبيعتها: إعادة إنشاء الجدول تُخرج الجميع مرة واحدة فقط.
DROP TABLE sessions;

-- نفس المتصفح يمكن أن يُسجَّل لأكثر من حساب، فيصير التفرد على (الحساب، المتصفح)
CREATE TABLE devices_new (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  label TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'revoked')),
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  UNIQUE (account_id, token_hash)
);
INSERT INTO devices_new (id, account_id, token_hash, label, status, created_at, last_used_at)
  SELECT id, account_id, token_hash, label, status, created_at, last_used_at FROM devices;
DROP TABLE devices;
ALTER TABLE devices_new RENAME TO devices;
CREATE INDEX devices_by_account ON devices(account_id);
CREATE INDEX devices_by_status ON devices(status);

-- stage = device: كلمة المرور صحيحة والجهاز بانتظار موافقة الأستاذ.
-- device_id: حذف الجهاز يُخرج كل جلساته فورًا.
-- profile_kind و student_id: الملف المختار بعد الدخول (الولي أو أحد الأبناء).
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('mfa', 'device', 'full')),
  device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
  profile_kind TEXT CHECK (profile_kind IN ('parent', 'student')),
  student_id INTEGER REFERENCES students(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX sessions_by_account ON sessions(account_id);
CREATE INDEX sessions_by_device ON sessions(device_id);

-- رمز من 4 أرقام اختياري لكل ملف، مع قفل بعد 5 محاولات خاطئة.
ALTER TABLE students ADD COLUMN pin_hash TEXT;
ALTER TABLE students ADD COLUMN pin_failed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE students ADD COLUMN pin_locked_until INTEGER;
ALTER TABLE accounts ADD COLUMN parent_pin_hash TEXT;
ALTER TABLE accounts ADD COLUMN parent_pin_failed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN parent_pin_locked_until INTEGER;
