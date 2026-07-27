# Freedom Bot

게임 공지와 패치노트를 감지해 Discord 서버에 알려주는 봇입니다.

## 요구 사항

- Node.js 24 LTS
- Discord 애플리케이션과 봇 토큰

## Discord 봇 만들기

1. [Discord Developer Portal](https://discord.com/developers/applications)에서 **New Application**을 선택합니다.
2. **Bot** 페이지에서 토큰을 발급합니다. 토큰은 다시 확인하기 어려우므로 `.env`에만 보관하고 Git에는 올리지 않습니다.
3. **Installation** 페이지의 Guild Install에 `applications.commands`, `bot` 스코프를 추가합니다.
4. Bot Permissions에는 `View Channels`, `Send Messages`, `Embed Links`를 선택합니다.
5. Installation 페이지의 설치 링크로 테스트 서버에 봇을 추가합니다.
6. Discord에서 개발자 모드를 켠 뒤 테스트 서버를 우클릭해 서버 ID를 복사합니다.

현재 기능에는 Privileged Gateway Intents가 필요하지 않습니다.

설치 화면에서는 **Add to server**를 선택해야 합니다. **Add to my apps**만 선택하면 슬래시 명령어는 보이지만 봇 사용자가 서버 채널에 접근하거나 공지를 전송할 수 없습니다.

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
KIS_APP_KEY=
KIS_APP_SECRET=
KIS_BASE_URL=https://openapi.koreainvestment.com:9443
KIS_WS_URL=ws://ops.koreainvestment.com:21000
```

개발 서버에 슬래시 명령어를 등록한 뒤 봇을 실행합니다.

```bash
npm run register:commands
npm run dev
```

Discord에서 `/status`를 실행해 봇이 정상적으로 응답하는지 확인할 수 있습니다.

`/엔드필드 공지`를 실행하면 공식 홈페이지의 전체 공지 목록을 10개씩 확인할 수 있습니다. 버튼으로 이전/다음 페이지를 넘길 수 있고, 특정 페이지부터 보고 싶으면 `/엔드필드 공지 페이지:2`처럼 실행합니다.

한국투자증권 Open API 앱키를 설정하면 `/시세 종목:005930`, `/시세 종목:NVDA`처럼 국내·미국 주식 현재가를 조회할 수 있습니다. 미국 주식은 티커뿐 아니라 KIS 종목 마스터의 한글명과 영문명으로도 검색·자동완성할 수 있습니다.
`/시세`는 미국 주식의 데이장·프리장·정규장·애프터장 구분과, 국내 주식의 개인·외국인·기관 수급을 함께 표시합니다. 수급은 KIS가 장 마감 뒤 제공하는 최근 확정 데이터를 사용합니다.
`/야간선물`을 실행하면 KOSPI200 KRX 야간선물의 최근월물을 자동으로 찾아 현재가, 전일 대비, 시가·고가·저가, 누적 거래량을 표시합니다.
`/시장현황`을 실행하면 KOSPI, KOSDAQ, 나스닥 종합, S&P 500의 현재값과 전일 대비를 한 번에 확인할 수 있습니다.
`/지수 지수:KOSPI`처럼 실행하면 선택한 지수의 시가·고가·저가·전일 종가를 자세히 확인할 수 있으며, 국내 지수는 상승·보합·하락 종목 수도 함께 표시합니다.
`/야간선물알림 켜기`를 실행하면 KOSPI 야간선물의 기준가격 대비 `+/-1%`부터 `+/-8%`까지 돌파를 KRX 야간장(18:00~06:00)에 실시간 감시합니다. 같은 방향의 같은 구간은 세션당 한 번만 전송합니다.
`/거래량 종목:삼성전자`, `/거래량 종목:AAPL`을 실행하면 오늘 누적 거래량이 최근 평균보다 많은지 확인할 수 있습니다.
`/뉴스 종목:삼성전자`를 실행하면 KRX/NXT 주가 흐름과 해당 종목의 최근 뉴스 제목을 함께 확인할 수 있습니다. 뉴스 제목은 변동 원인을 살피는 참고 정보이며, 원인 자체를 확정하는 정보는 아닙니다.
`/주가알림 추가 종목:삼성전자`, `/주가알림 추가 종목:TSLA`를 실행하면 해당 종목의 당일 시가 대비 `+/-3%`, `+/-5%`, `+/-8%`, `+/-10%` 돌파를 실시간으로 감시합니다. 국내는 정규장 KRX 체결가와 애프터장 NXT 체결가를 사용하고, 미국은 NASDAQ·NYSE·AMEX 정규장 체결가를 사용합니다. 같은 구간은 거래일마다 한 번만 알림 채널에 전송됩니다.

서버 관리 권한이 있는 사용자는 `/test-notification`을 실행해 설정된 알림 채널로 샘플 Embed가 정상 전송되는지 확인할 수 있습니다. 명령어를 추가하거나 변경한 뒤에는 `npm run register:commands`를 다시 실행해야 합니다.

봇은 시작 직후 엔드필드의 현재 공지를 확인합니다. 첫 실행에서는 기존 공지를 SQLite 데이터베이스 `.data/freedom-bot.sqlite`에 저장만 하며, 이후 처음 발견한 공지만 알림 채널에 전송합니다. 이전 JSON 저장소가 있으면 자동으로 SQLite에 이전됩니다.

Discord 연결 없이 공지 수집만 확인하려면 다음 명령어를 사용합니다.

```bash
npm run check:news
```

SQLite에 저장된 최근 공지와 알림 상태는 다음 명령어로 확인합니다.

```bash
npm run list:news
```

국내 상장 종목명 검색 데이터는 같은 SQLite 파일에 저장됩니다. 최신 종목 목록으로 갱신하려면 다음 명령어를 실행합니다.

```bash
npm run update:stocks
```

미국 상장 종목명 검색 데이터(NASDAQ·NYSE·AMEX)는 다음 명령어로 갱신합니다.

```bash
npm run update:overseas-stocks
```

SQLite는 애플리케이션에 포함된 드라이버를 사용하므로 운영체제에 별도로 설치할 필요가 없습니다.

## Windows 미니PC 실행

64비트 Windows와 Node.js 24 LTS 환경에서 프로젝트를 복사한 뒤 PowerShell에서 실행합니다.

```powershell
npm ci
Copy-Item .env.example .env
npm run register:commands
npm run build
npm start
```

Mac의 `.env` 값은 Windows의 `.env`에도 직접 입력해야 합니다. `.data/freedom-bot.sqlite`에는 공지 이력이 저장되므로 미니PC로 이전하거나 정기적으로 백업하는 것이 좋습니다. 서로 다른 두 컴퓨터에서 봇을 동시에 실행하면 중복 알림이 발생할 수 있으므로 한 곳에서만 실행합니다.

## 확인 명령어

```bash
npm run typecheck
npm test
npm run build
```

`DISCORD_GUILD_ID`를 비우고 명령어를 등록하면 모든 서버에 적용되는 전역 명령어가 됩니다. 전역 명령어 반영에는 시간이 걸릴 수 있습니다.
