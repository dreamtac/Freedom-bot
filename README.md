# Freedom Bot

게임 공지와 패치노트를 감지해 Discord 서버에 알려주는 봇입니다.

## 요구 사항

- Node.js 20.18 이상
- Discord 애플리케이션과 봇 토큰

## Discord 봇 만들기

1. [Discord Developer Portal](https://discord.com/developers/applications)에서 **New Application**을 선택합니다.
2. **Bot** 페이지에서 토큰을 발급합니다. 토큰은 다시 확인하기 어려우므로 `.env`에만 보관하고 Git에는 올리지 않습니다.
3. **Installation** 페이지의 Guild Install에 `applications.commands`, `bot` 스코프를 추가합니다.
4. Bot Permissions에는 `View Channels`, `Send Messages`, `Embed Links`를 선택합니다.
5. Installation 페이지의 설치 링크로 테스트 서버에 봇을 추가합니다.
6. Discord에서 개발자 모드를 켠 뒤 테스트 서버를 우클릭해 서버 ID를 복사합니다.

현재 기능에는 Privileged Gateway Intents가 필요하지 않습니다.

## 로컬 실행

```bash
npm install
cp .env.example .env
```

`.env`에 Discord Developer Portal에서 확인한 값을 입력합니다.

```dotenv
DISCORD_BOT_TOKEN=봇_토큰
DISCORD_CLIENT_ID=애플리케이션_ID
DISCORD_GUILD_ID=개발_서버_ID
DISCORD_NOTIFICATION_CHANNEL_ID=공지_알림을_받을_채널_ID
NEWS_POLL_INTERVAL_MS=300000
```

개발 서버에 슬래시 명령어를 등록한 뒤 봇을 실행합니다.

```bash
npm run register:commands
npm run dev
```

Discord에서 `/status`를 실행해 봇이 정상적으로 응답하는지 확인할 수 있습니다.

봇은 시작 직후 엔드필드의 현재 공지를 확인합니다. 첫 실행에서는 기존 공지를 `.data/seen-posts.json`에 저장만 하며, 이후 처음 발견한 공지만 알림 채널에 전송합니다.

Discord 연결 없이 공지 수집만 확인하려면 다음 명령어를 사용합니다.

```bash
npm run check:news
```

## 확인 명령어

```bash
npm run typecheck
npm test
npm run build
```

`DISCORD_GUILD_ID`를 비우고 명령어를 등록하면 모든 서버에 적용되는 전역 명령어가 됩니다. 전역 명령어 반영에는 시간이 걸릴 수 있습니다.
