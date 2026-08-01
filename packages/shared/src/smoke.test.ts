import { describe, expect, it } from 'vitest'
import { SHARED_PACKAGE_READY } from './index.js'

describe('workspace wiring', () => {
  it('shared 패키지를 import 할 수 있다', () => {
    expect(SHARED_PACKAGE_READY).toBe(true)
  })
})
