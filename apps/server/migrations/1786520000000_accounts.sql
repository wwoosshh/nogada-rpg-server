-- Up Migration

-- 계정 하나. 게임의 문이고, 캐릭터의 주인이다.
--
-- `username` 은 **정규화된 것만** 들어온다(NFC + trim + 소문자). 정규화를 DB 가
-- 아니라 앱이 하는 이유는, 찾을 때와 넣을 때가 반드시 같은 함수를 지나야
-- UNIQUE 가 뜻을 갖기 때문이다 — 한쪽만 lower(username) 인덱스를 쓰면 눈에
-- 똑같은 아이디 둘이 서로 다른 계정이 된다(설계 규범 5).
--
-- 비밀번호는 argon2id 해시만 담는다. 되돌릴 방법은 없고, 그래서 비밀번호 찾기도
-- 없다 — 잊으면 계정이 죽는다(설계 규범 6에서 명시적으로 수용).
CREATE TABLE users (
  id         BIGSERIAL   PRIMARY KEY,
  username   TEXT        NOT NULL UNIQUE,
  pw_hash    TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 로그인한 기기 하나 = 세션 하나.
--
-- **키가 토큰이 아니라 `sha256(토큰)` 이다.** 토큰을 그대로 담으면 DB 백업 한
-- 부가 그대로 남의 계정 열쇠 꾸러미가 된다 — 비밀번호를 해시하는 것과 정확히
-- 같은 이유이고, 세션 탈취는 비밀번호를 몰라도 되므로 피해도 같다(설계 규범 5).
-- 해시는 되돌릴 수 없지만 우리가 하는 일은 "이 토큰이 있는가" 하나라, 들고 온
-- 토큰을 같은 방식으로 찍어 견주면 그것으로 충분하다.
--
-- 계정이 사라지면 세션도 사라진다(CASCADE) — 남아 있으면 주인 없는 열쇠다.
CREATE TABLE sessions (
  token_hash TEXT        PRIMARY KEY,
  user_id    BIGINT      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);

-- 로그아웃은 행 하나를 지우지만, 만료 청소와 "이 계정의 세션 전부"는 계정으로
-- 훑는다. 세션이 사람 수만큼 쌓이므로 그때 전수 검색이 되지 않게 한다.
CREATE INDEX sessions_user_id_idx ON sessions (user_id);

-- **계정 이전의 캐릭터는 주인이 없다.** 지금 이 표에 있는 것은 부팅 관문이
-- 만들어 준 'local' 하나뿐이고(개발용 세이브), 설계는 그것을 이관하지 않고
-- 폐기하기로 정했다(규범 15). 주인 없는 행을 남기면 아래 NOT NULL 이 걸리고,
-- 억지로 아무 계정에 붙이면 남의 진행도를 누군가에게 주는 것이 된다.
DELETE FROM characters;

-- 캐릭터는 계정당 하나다(v1). 그 사실을 코드의 관례가 아니라 **제약**으로 둔다 —
-- 이중 제출로 들어온 두 번째 생성이 여기서 막히고(23505), 라우트는 그것을 잡아
-- 이미 있는 캐릭터를 돌려준다(설계 규범 6).
--
-- `name` 은 상태(JSONB)의 **사본**이다. 원본은 언제나 state 이고 이 칸은 저장할
-- 때 함께 찍는다 — 사람이 DB 를 들여다볼 때 JSONB 를 헤집지 않으려는 칸이지
-- 게임이 읽는 칸이 아니다(설계 규범 4).
ALTER TABLE characters
  ADD COLUMN user_id BIGINT NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  ADD COLUMN name    TEXT   NOT NULL DEFAULT '';

-- Down Migration

ALTER TABLE characters
  DROP COLUMN user_id,
  DROP COLUMN name;

DROP TABLE sessions;
DROP TABLE users;
