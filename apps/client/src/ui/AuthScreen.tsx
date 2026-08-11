import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  RegisterRequestSchema,
  USERNAME_MAX,
  USERNAME_MIN,
} from '@nogada/shared'
import { useState } from 'react'
import { useGameStore, type AuthMode } from '../store/gameStore.js'

const RULES = `아이디 ${USERNAME_MIN}~${USERNAME_MAX}자 (영문·숫자·한글) · 비밀번호 ${PASSWORD_MIN}자 이상`

/**
 * 가입할 수 있는 입력인지 **보내기 전에** 본다.
 *
 * 서버의 `RegisterRequestSchema` 를 그대로 쓰는 것이 요점이다(설계 §3 이 규칙을
 * shared 에 둔 이유). 여기서 규칙을 다시 적으면 화면이 받아 준 아이디가 서버에서
 * 400 이 되거나 그 반대가 되는데, 그 어긋남은 "왜 안 되는지 화면이 말해 주지
 * 않는" 형태로만 드러난다.
 *
 * 로그인은 검사하지 않는다 — 서버도 가입보다 너그럽게 받는다(LoginRequestSchema
 * 문서). 규칙이 언젠가 조여질 때 이미 가입한 사람이 자기 계정에서 잠기지
 * 않으려면, 로그인의 판정은 형식이 아니라 존재여야 한다.
 */
function localProblem(mode: AuthMode, username: string, password: string): string | null {
  if (username.trim() === '' || password === '') return '아이디와 비밀번호를 적어 주세요.'
  if (mode === 'login') return null
  return RegisterRequestSchema.safeParse({ username, password }).success ? null : RULES
}

/** 로그인 ⇄ 가입. 화면 하나가 둘을 오간다(설계 §5) — 오갈 때 적던 것은 그대로 둔다. */
export function AuthScreen(): JSX.Element {
  const [mode, setMode] = useState<AuthMode>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const gateError = useGameStore((s) => s.gateError)
  const gateBusy = useGameStore((s) => s.gateBusy)
  const authenticate = useGameStore((s) => s.authenticate)
  const showTitle = useGameStore((s) => s.showTitle)

  const submit = (): void => {
    const problem = localProblem(mode, username, password)
    setLocalError(problem)
    if (problem) return
    void authenticate(mode, username, password)
  }

  return (
    <div className="screen">
      <form
        className="screen__panel screen__panel--narrow"
        onSubmit={(e) => {
          // 폼으로 감싸는 이유는 모바일 키보드의 "완료" 키다. 버튼만 두면 키보드를
          // 내리고 다시 화면을 눌러야 한다.
          e.preventDefault()
          submit()
        }}
      >
        <div className="screen__tabs">
          {(['login', 'register'] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={m === mode ? 'screen__tab screen__tab--on' : 'screen__tab'}
              onClick={() => {
                setMode(m)
                setLocalError(null)
              }}
            >
              {m === 'login' ? '로그인' : '가입'}
            </button>
          ))}
        </div>

        <label className="field">
          <span className="field__label">아이디</span>
          <input
            className="field__input"
            value={username}
            maxLength={USERNAME_MAX}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="username"
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>

        <label className="field">
          <span className="field__label">비밀번호</span>
          <input
            className="field__input"
            type="password"
            value={password}
            maxLength={PASSWORD_MAX}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        <p className="screen__hint">{RULES}</p>
        {/*
          방금 누른 것에 대한 답을 먼저 보여준다. 서버의 답(gateError)은 다음
          제출 전까지 남아 있으므로, 두 개가 동시에 뜨면 어느 쪽이 이번 것인지
          알 수 없다 — 눌러 보기 전에 걸린 것은 언제나 여기 것이다.
        */}
        {(localError ?? gateError) !== null && (
          <p className="screen__error">{localError ?? gateError}</p>
        )}

        <button type="submit" className="btn btn--primary" disabled={gateBusy}>
          {gateBusy ? '…' : mode === 'login' ? '로그인' : '가입하고 시작'}
        </button>
        <button type="button" className="btn btn--ghost" disabled={gateBusy} onClick={showTitle}>
          뒤로
        </button>
      </form>
    </div>
  )
}
