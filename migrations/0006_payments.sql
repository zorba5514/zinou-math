-- الدفعات: المبلغ الذي دفعه الولي (من الوصل)، ويُقسَّم بالتساوي على اشتراكات أبنائه.
-- كل الأوقات بالمللي ثانية منذ 1970 (Date.now()). المبالغ بالدينار الجزائري.

CREATE TABLE payments (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK (amount > 0),
  receipt TEXT,
  paid_at INTEGER NOT NULL,
  created_by INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX payments_by_account ON payments(account_id, paid_at);

-- كل اشتراك: الدفعة التي غطّته ونصيبه منها، أو موعد آخر أجل للدفع إن لم يُدفع بعد.
-- اشتراك بلا دفعة وبلا أجل (القديمة) يُعتبر مدفوعًا.
ALTER TABLE subscriptions ADD COLUMN payment_id INTEGER REFERENCES payments(id) ON DELETE SET NULL;
ALTER TABLE subscriptions ADD COLUMN amount INTEGER;
ALTER TABLE subscriptions ADD COLUMN pay_due_at INTEGER;
CREATE INDEX subscriptions_by_due ON subscriptions(pay_due_at) WHERE payment_id IS NULL;

-- معاينة الأستاذ للموقع كما يراه التلميذ: subscribed أو free، وNULL لعرض الأستاذ العادي.
ALTER TABLE sessions ADD COLUMN preview TEXT;
