# 보안 설정

인증정보는 소스 코드에 저장하지 않습니다.

## 로컬 프록시

1. `.env.example`을 `.env`로 복사합니다.
2. 발급받은 값을 `.env`에 입력합니다.
3. 기존에 소스 또는 배포본에 포함됐던 키는 각 제공기관에서 폐기하고 새로 발급합니다.
4. `서버시작.bat` 또는 `node proxy-server.js`로 서버를 다시 시작합니다.

필요한 환경변수:

- `SC_CLIENT_ID`
- `SC_API_KEY`
- `SC_MAC_ADDR`
- `NTIS_API_KEY`
- `CEREBRAS_API_KEY`

`.env`는 `.gitignore`에 포함되어 저장소에 커밋되지 않습니다.

## Vercel

동일한 이름의 환경변수를 Vercel 프로젝트 설정에 등록한 뒤 재배포합니다.
Cerebras 요청은 `/cerebras` 서버리스 프록시에서 인증정보를 주입하므로 브라우저에 AI 키가 노출되지 않습니다.

## 브라우저 저장소 마이그레이션

앱은 보안 버전 3 최초 실행 시 과거 버전이 저장한 `sc_api_key`, `sc_ntis_key`,
`sc_cerebras_key`를 한 번 제거합니다. 서버 환경변수 방식이 권장됩니다.

## 운영 주의

- `/health`는 키 자체가 아니라 설정 여부만 반환합니다.
- 분석 이력 JSON에는 검색어, 건수, 상태, 점수만 저장하며 인증정보는 포함하지 않습니다.
- 특허 패밀리·시장·TRL 확장 데이터는 연결 전까지 `not_connected`로 기록됩니다.
# Local browser development mode

While the site is being developed locally, `BROWSER_API_MODE` is enabled in
`js/state.js`. Enter development API keys in `BROWSER_API_CONFIG` or through
the API settings dialog; values entered in the dialog are stored only in that
browser's local storage. Set `BROWSER_API_MODE` to `false` and remove browser
keys before publishing.
