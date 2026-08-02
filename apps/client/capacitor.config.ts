import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.nogadarpg.fanmade',
  appName: '노가다 RPG',
  webDir: 'dist',
  android: {
    // 개발 중에는 PC 의 로컬 서버(http)에 붙어야 하므로 평문 통신을 허용한다.
    // M4 온라인 개방 시 https 로 전환하고 이 옵션을 제거한다.
    allowMixedContent: true,
  },
}

export default config
