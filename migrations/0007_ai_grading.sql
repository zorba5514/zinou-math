-- المرحلة 6.5: الحكم على الإجابات القصيرة بالذكاء الاصطناعي (Workers AI).
-- ai_verdict: حكم الذكاء الاصطناعي على إجابة لم تطابق قائمة الأستاذ (correct أو wrong)، وai_reason سببه المختصر.
-- attempts.ai_review = 1: في المحاولة إجابات حكم عليها الذكاء الاصطناعي ولم يراجعها الأستاذ بعد.
ALTER TABLE answers ADD COLUMN ai_verdict TEXT CHECK (ai_verdict IS NULL OR ai_verdict IN ('correct', 'wrong'));
ALTER TABLE answers ADD COLUMN ai_reason TEXT;
ALTER TABLE attempts ADD COLUMN ai_review INTEGER NOT NULL DEFAULT 0;
CREATE INDEX attempts_ai_review ON attempts(ai_review) WHERE ai_review = 1;
