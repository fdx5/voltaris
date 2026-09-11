# VOLTARIS

지구·화성·목성·해왕성을 배경으로 한 4스테이지 3D 횡스크롤 슈팅 게임입니다. React / TypeScript / Three.js로 렌더링하며, Node.js / Express 서버와 Turso(libSQL)에 사용자·세션·게임 이력·클리어 기록을 저장합니다.

저장소: https://github.com/fdx5/voltaris

## 기본 동작

- 처음 접속하면 ID / 비밀번호로 로그인하거나 회원가입합니다. ID는 영문·숫자·밑줄 3~~24자, 비밀번호는 4~~128자입니다. ID는 대소문자를 구분하지 않습니다.
- 새 계정은 **STAGE 01만 활성화**됩니다. 일반 모드에서 1을 클리어해야 2, 2를 클리어해야 3, 3을 클리어해야 4에 진입할 수 있습니다.
- 잠금은 메뉴와 서버 양쪽에서 적용됩니다. 잠긴 스테이지의 보스 훈련도 제한됩니다. **훈련 클리어는 다음 스테이지를 해금하지 않습니다.**
- 클리어 후 서버가 같은 게임 시뮬레이션으로 입력 기록을 재실행합니다. 검증된 결과가 저장된 뒤 다음 스테이지 버튼이 활성화됩니다. 클라이언트가 보낸 점수나 `clear` 문자열만으로는 해금되지 않습니다.
- 전체 파일럿의 실제 게임 이력을 조회합니다. ID / 스테이지 필터, 내 기록, 페이지 이동을 지원합니다. 공개되는 정보는 ID와 플레이 통계이며 비밀번호·세션은 공개하지 않습니다.
- 출격 시작 즉시 DB에 기록합니다. 완료·게임오버·메뉴로 포기한 출격은 최종 결과를 저장합니다. 탭 강제 종료나 연결 단절로 결과를 제출하지 못한 출격은 `진행 / 미완료`로 남습니다.
- 저장 실패 시 **저장 다시 시도**를 누릅니다. 페이지를 유지하는 동안 동일한 기록으로 재시도하며 중복 저장·중복 해금하지 않습니다.
- 오버드라이브: **3초 무적**, 기존 공격 강화·적 감속 효과 동시 발동.
- WebGPU 우선, 미지원 환경은 WebGL 2로 동작합니다. `?webgl=1`로 WebGL 2를 강제할 수 있습니다.

## Render 배포 — Blueprint

로그인 API가 포함되어 있으므로 Render의 **Node Web Service**로 배포합니다. Static Site는 사용하지 않습니다.

1. [Render Dashboard](https://dashboard.render.com/)에서 **New → Blueprint**를 선택합니다.
2. GitHub를 연결하고 `fdx5/voltaris` 저장소, `main` 브랜치를 선택합니다.
3. 루트의 `render.yaml` 설정을 확인합니다. 서비스명 `voltaris`, 리전 `Singapore`, Node Web Service가 생성됩니다.
4. **`TURSO_AUTH_TOKEN`에 본인의 Turso DB 토큰을 비밀 환경변수로 입력**합니다. 토큰은 저장소에 없습니다. DB URL은 Blueprint에 들어 있습니다.
5. Apply / Deploy를 실행합니다. 첫 서버 시작 시 스키마와 4개 스테이지 기준 데이터가 자동 생성됩니다. 기존 사용자·게임 이력은 삭제하지 않습니다.
6. 발급된 `https://…onrender.com` 주소로 접속하여 회원가입 후 STAGE 01을 시작합니다.

`render.yaml`은 Free 인스턴스를 기본값으로 사용합니다. 필요에 따라 Render에서 사양을 변경할 수 있습니다. 무료 서비스는 유휴 후 재시작 시 첫 요청이 느릴 수 있습니다.

### 수동 Web Service 생성 시 설정

| Render 항목        | 값                                      |
| ------------------ | --------------------------------------- |
| Repository         | `https://github.com/fdx5/voltaris`      |
| Branch             | `main`                                  |
| Language / Runtime | `Node`                                  |
| Region             | `Singapore`                             |
| Root Directory     | 비워 둠 (저장소 루트)                   |
| Build Command      | `npm ci --include=dev && npm run build` |
| Start Command      | `npm start`                             |
| Health Check Path  | `/api/health`                           |
| Auto Deploy        | `main` 커밋 기준                        |
| Publish Directory  | 설정하지 않음 (Web Service)             |

### Render 환경변수

| 키                   | 값                                                                                                 |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| `NODE_ENV`           | `production`                                                                                       |
| `NODE_VERSION`       | `22`                                                                                               |
| `TURSO_DATABASE_URL` | `libsql://voltaris-fdx5555.aws-ap-northeast-1.turso.io`                                            |
| `TURSO_AUTH_TOKEN`   | 발급받은 토큰. Render Environment에만 입력                                                         |
| `APP_ORIGIN`         | 선택: `https://voltaris.onrender.com`처럼 실제 공개 주소. 끝의 `/` 없이 입력. 기본값은 요청 호스트 |

`PORT`는 Render가 제공하는 값을 그대로 사용하며 `0.0.0.0`에 바인딩합니다. 프런트와 API는 동일한 도메인으로 제공하므로 별도 API URL이나 CORS 설정이 필요하지 않습니다. DB 토큰에 `VITE_` 접두사를 붙이지 마세요. 브라우저 번들에 포함하면 안 됩니다.

서버 시작 시 마이그레이션을 실행하므로 별도 Pre-Deploy Command나 영구 디스크는 필요하지 않습니다. 운영 데이터는 Render 로컬 파일이 아닌 Turso 원격 DB에 저장됩니다.

공식 문서: [Node / Express 배포](https://render.com/docs/deploy-node-express-app), [Blueprint 설정](https://render.com/docs/blueprint-spec), [Node 버전](https://render.com/docs/node-version), [Turso 클라이언트](https://github.com/tursodatabase/libsql-client-ts).

## 로컬 개발

Node.js 22.12 이상(22 또는 24 계열), npm이 필요합니다.

```bash
git clone https://github.com/fdx5/voltaris.git
cd voltaris
npm ci
```

`.env.example`을 `.env`로 복사합니다. 기존 `.env`가 있으면 그대로 사용합니다.

```powershell
Copy-Item .env.example .env
```

예제 설정은 `.local/voltaris.db` 로컬 SQLite DB를 사용하므로 Turso 토큰 없이도 회원가입·이력·해금을 개발할 수 있습니다. 원격 Turso를 사용하려면 `.env`의 `TURSO_DATABASE_URL`과 `TURSO_AUTH_TOKEN`을 설정합니다. `.env`는 Git에서 제외됩니다.

```bash
npm run dev
```

- 브라우저: http://localhost:5173/
- API: http://localhost:3001/api/health
- Vite의 `/api` 프록시가 Express 서버로 연결됩니다.
- 서버 게임 규칙을 수정하면 `npm run dev`를 재시작하여 검증 시뮬레이터도 다시 빌드합니다.
- 이미지·오디오·텍스처는 `public/`에 포함되어 있으므로 첫 빌드에 외부 이미지 다운로드가 필요하지 않습니다.

운영 빌드 확인:

```bash
npm run build
npm start
```

http://localhost:3001 에서 빌드된 게임과 API를 함께 제공합니다. `npm run preview`는 정적 파일 확인용이며 로그인 API를 제공하지 않으므로 실제 실행에는 `npm start`를 사용합니다.

## DB 설계와 초기 데이터

| 테이블              | 용도                                                                           |
| ------------------- | ------------------------------------------------------------------------------ |
| `schema_migrations` | 적용한 스키마 버전                                                             |
| `users`             | 고유 ID, 파일럿 ID, scrypt 비밀번호 해시, 생성 시각                            |
| `sessions`          | 세션 토큰 SHA-256 해시, 사용자, 만료 시각                                      |
| `stages`            | 4개 스테이지 ID / 이름 / 행성 기준 데이터                                      |
| `game_runs`         | 출격 설정, 검증 게임 버전, 결과, 점수·격추·시간, 이어하기 장비, 시작·종료 시각 |
| `stage_progress`    | 사용자·스테이지별 최초 일반 모드 클리어와 해당 출격 ID                         |

스키마: [`server/schema.sql`](server/schema.sql). 초기 데이터는 실제 스테이지 JSON에서 적재합니다. 기본 계정·공유 비밀번호·가짜 게임 기록은 만들지 않습니다. 최초 사용자는 회원가입으로 생성합니다.

```bash
npm run db:migrate
```

이 명령과 서버 시작 시 마이그레이션은 재실행해도 데이터를 중복 생성하지 않습니다. 클리어 결과와 스테이지 해금은 하나의 DB 쓰기 트랜잭션으로 반영됩니다.

## 인증과 결과 검증

- 비밀번호: 무작위 salt + scrypt. 평문 비밀번호를 DB나 로그에 저장하지 않습니다.
- 세션: 256비트 무작위 토큰, 7일 만료. DB에는 토큰 해시만 저장하며 쿠키는 `HttpOnly`, `SameSite=Strict`, 운영 환경에서 `Secure`입니다.
- 변경 API는 JSON, 같은 출처와 전용 요청 헤더를 검사합니다. 인증 시도·API 요청 횟수를 제한합니다.
- 이력 조회에는 로그인이 필요합니다. 다른 계정의 출격을 종료하거나 진행도를 변경할 수 없습니다.
- 리플레이 검증은 Worker Thread에서 수행하며 입력 크기·프레임 수·실행시간·동시 실행 수를 제한합니다. 점수·클리어·이어하기 장비는 서버에서 계산합니다.
- 입력 재실행은 단순 결과 위조를 막기 위한 검증입니다. 자동 플레이 방지나 경쟁용 부정행위 탐지 전체를 구현한 것은 아닙니다.
- 규칙이 배포 중 바뀌면 이전 버전의 미제출 결과는 해금하지 않고 새 출격을 안내합니다.
- 페이지를 닫기 전 저장 완료를 기다리세요. 로그인과 기록 저장에는 서버 연결이 필요하며 PWA 캐시만으로 계정 기능이 동작하지는 않습니다.

## 주요 API

| Method | Path                                    | 동작                             |
| ------ | --------------------------------------- | -------------------------------- |
| GET    | `/api/health`                           | 서버 / DB 상태                   |
| POST   | `/api/auth/register`                    | 회원가입 및 세션 발급            |
| POST   | `/api/auth/login`                       | 로그인                           |
| GET    | `/api/auth/me`                          | 세션 복원 및 내 진행도           |
| POST   | `/api/auth/logout`                      | 현재 세션 삭제                   |
| POST   | `/api/runs`                             | 잠금 확인 후 출격 생성           |
| POST   | `/api/runs/:id/finish`                  | 입력 재실행·검증, 이력·해금 저장 |
| GET    | `/api/history?page=1&stage=0&username=` | 전체 이력, 페이지당 20개         |

## 조작

| 입력          | 동작                              |
| ------------- | --------------------------------- |
| WASD / 방향키 | 이동                              |
| 기본          | 자동 사격                         |
| Z / Space     | 수동 사격, LASER Lv.5 이상 차지샷 |
| Q             | 옵션 모드 전환                    |
| Shift         | 옵션 제어                         |
| 1 / 2 / 3     | 특수기술                          |
| Esc           | 일시정지                          |
| 화면 드래그   | 터치 이동                         |

## 검증

```bash
npm test
npm run test:server
npm run lint
npm run build
npx playwright install chromium
npm run test:e2e
```

서버 테스트는 메모리 DB, 브라우저 테스트는 `.local/`의 별도 SQLite DB와 `127.0.0.1:4179` 서버를 사용합니다. 운영 Turso에 테스트 사용자나 이력을 만들지 않습니다. 렌더링 회귀 테스트는 해금된 API fixture를 사용하며, `auth.spec.ts`는 실제 API로 회원가입·로그인·잠금·저장·조회를 검증합니다.

## 구조와 에셋

```text
src/core/        게임 루프, 입력, 렌더링, 오디오, 출격 기록 수집
src/game/        브라우저와 서버가 공유하는 시뮬레이션
src/visual/      기체·보스·행성 모델
src/ui/          로그인, 메뉴, HUD, 전체 이력
server/         Express API, DB, 인증, 리플레이 검증
data/           스테이지·유닛·무기·튜닝 데이터
public/         배포할 이미지·오디오·텍스처
tests/          단위·서버·브라우저 테스트
render.yaml     Render Blueprint
```

기존 Sites용 `worker/`와 `tools/build-hosting.mjs`는 정적 프런트용 보조 도구입니다. 현재 기본 배포는 Render의 `server/index.mjs`이며 해당 Worker만 배포해서는 로그인 API가 제공되지 않습니다.

메뉴 사진 출처: [`public/images/missions/CREDITS.md`](public/images/missions/CREDITS.md). 행성 텍스처는 NASA / Three.js 예제 및 [Solar System Scope](https://www.solarsystemscope.com/textures)(CC BY 4.0), 암석·얼음 텍스처는 [Poly Haven](https://polyhaven.com/)(CC0) 자료를 사용합니다. 레벨 4의 2K 얼음 PBR 재질은 [ambientCG Ice 004](https://ambientcg.com/view?id=Ice004)(CC0)입니다. 별하늘은 내려받지 않고 `tools/fetch-textures.mjs`가 직접 그립니다. `tools/fetch-textures.mjs`에 원본 경로가 있습니다. `public/audio/`는 프로젝트에서 제공한 게임 오디오입니다. 이 저장소는 제3자 에셋의 별도 이용 조건을 대체하지 않습니다.

## 아이폰 화면 회귀 검사

`tests/e2e/iphone.spec.ts`는 전체화면 API가 없는 환경, 노치·홈 표시줄 안전영역,
주소창에 따른 표시 높이 변화, 터치 가능한 HUD와 일시정지를 검사합니다.
`npx playwright install webkit` 후 `npx playwright test --config playwright.webkit.config.ts`로
WebKit에서도 실행할 수 있습니다. Windows WebKit/Chromium 자동 검사는 실제 iPhone 하드웨어,
iOS Safari의 주소창 애니메이션 또는 홈 화면 설치 검증을 대체하지 않습니다.
