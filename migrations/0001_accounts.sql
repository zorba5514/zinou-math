-- المرحلة 2: الحسابات وتسجيل الدخول.
-- كل الأوقات بالمللي ثانية منذ 1970 (Date.now()).

-- حساب الولي أو الأستاذ. اسم المستخدم هو رقم الهاتف.
CREATE TABLE accounts (
  id INTEGER PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('parent', 'admin')),
  phone TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  -- كلمة المرور مشفّرة: pbkdf2-sha256$<عدد التكرارات>$<الملح>$<البصمة>
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  -- مفتاح الرمز ذي الأرقام الستة (لحساب الأستاذ فقط)
  totp_secret TEXT,
  note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- الأبناء: ملفات فرعية داخل حساب الولي.
CREATE TABLE students (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  level TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX students_by_account ON students(account_id);

-- الجلسات: يُحفظ هنا بصمة رمز الجلسة فقط، لا الرمز نفسه.
-- stage = mfa: كلمة المرور صحيحة وبانتظار الرمز ذي الأرقام الستة.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('mfa', 'full')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX sessions_by_account ON sessions(account_id);

-- الأجهزة المعتمدة. في المرحلة 2 لأجهزة الأستاذ، وفي المرحلة 3 لأجهزة العائلات.
CREATE TABLE devices (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'revoked')),
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX devices_by_account ON devices(account_id);

-- رموز الطوارئ لحساب الأستاذ إذا ضاع هاتفه. كل رمز يُستعمل مرة واحدة.
CREATE TABLE recovery_codes (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at INTEGER
);
CREATE INDEX recovery_by_account ON recovery_codes(account_id);

-- سجل العمليات الحساسة.
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  actor_id INTEGER,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT
);
CREATE INDEX audit_by_time ON audit_log(at);
