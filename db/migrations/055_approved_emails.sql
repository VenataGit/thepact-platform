-- 055: Одобрени имейли (whitelist) за вход в платформата.
--
-- Досега достъпът се решаваше САМО живо от Basecamp: влиза който е „не-клиент" в
-- акаунта на The Pact или е в проекта Video Production. Нов човек, който още не е
-- добавен там (или е заведен като клиент/гост), опираше в „Нямаш достъп".
--
-- Оттук нататък админ може просто да добави имейла, с който човекът е в Basecamp —
-- при вход имейлът се сверява с този списък и ако е вътре, човекът минава без
-- проверката за екип. Профилът му се създава сам при първото влизане, както винаги.
-- Имейлът се пази винаги с малки букви, за да няма дубликати заради главни букви.

CREATE TABLE IF NOT EXISTS approved_emails (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  note          TEXT NOT NULL DEFAULT '',        -- кой е човекът / защо е пуснат
  added_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ                      -- кога за последно е влизал с него
);
