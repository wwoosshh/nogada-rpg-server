-- Up Migration

-- 캐릭터 한 사람의 상태 통째. `state` 를 JSONB 한 칸에 두는 이유는
-- PlayerStateSchema(zod)가 계속 진실의 원본이기 때문이다 — 스키마의 기본값이
-- 옛 세이브를 살리는 장치가 여기서도 그대로 작동한다. 정규화 분해는 실제로
-- 쿼리할 필요가 생길 때 한다(설계 §2).
--
-- id 가 BIGSERIAL 이 아니라 TEXT 인 이유: 캐릭터 키를 **누가 짓는가**는 계정이
-- 정해지는 A2 의 질문이다. 지금은 라우트가 'local' 하나를 부르고, 다음에는
-- 가입이 키를 발급한다. 어느 쪽이든 문자열 하나면 되고, 읽기 계층은 이 칸의
-- 값을 PlayerState.id 에 도장 찍는다(설계 규범 4).
CREATE TABLE characters (
  id         TEXT        PRIMARY KEY,
  state      JSONB       NOT NULL,
  -- 판본이다. 낙관적 잠금이 이 칸 하나로 돈다: 읽을 때 본 값과 같을 때만 쓴다.
  -- 기본값이 clock_timestamp() 인 것은 now() 가 트랜잭션 시작 시각이라 한
  -- 트랜잭션 안의 두 쓰기가 같은 값을 받기 때문이다.
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Down Migration

DROP TABLE characters;
