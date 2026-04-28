# OS_Search

Cisco Support API를 사용해 다음 3가지를 조회하는 도구입니다.

1. 장비 PID 기준 권장 OS 조회 + 해당 권장 OS의 EoX 조회
2. OS 버전 기준 직접 EoX 조회
3. 하드웨어 Serial Number 또는 Product ID 기준 EoX 조회

기본 출력은 사람이 읽기 쉬운 표 형식이며, `--debug` 옵션에서만 API 원문을 출력합니다.

## 요구 사항

- Python 3.11+
- Cisco Support API 접근 권한
- Cisco API Console에서 발급한 `CLIENT_ID`, `CLIENT_SECRET`

## 설치

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

## 환경 변수

`.env.example`를 참고해 `.env`를 생성합니다.

```env
CLIENT_ID=your_client_id
CLIENT_SECRET=your_client_secret
REQUEST_TIMEOUT=30
LOG_LEVEL=INFO
```

## 사용 예시

장비 PID 기준 조회:

```bash
python -m src.cli pid "C9200,ASR1001-X,N9K-C93180YC-EX"
```

OS 버전 기준 조회:

```bash
python -m src.cli os "17.9.5,17.11.1a,10.3(6)"
python -m src.cli os "10.3(6)"
```

CSV 저장:

```bash
python -m src.cli pid "C9200,ASR1001-X" --csv result.csv
python -m src.cli os "17.9.5,10.3(6)" --csv eox.csv
```

디버그 모드:

```bash
python -m src.cli pid "C9200" --debug
```

## 웹 페이지

웹 UI에서는 다음 3가지 모드를 함께 사용할 수 있습니다.

- `OS 검색`: software release 기준 EoX 조회
- `OS 추천`: PID 기준 권장 OS 조회 후 해당 릴리스의 EoX 조회
- `HW 검색`: Serial Number / Product ID 기준 하드웨어 EoX 조회

### 로컬 실행

```bash
python -m src.webapp
```

실행 후 브라우저에서 `http://127.0.0.1:8080` 을 열면 됩니다.

### Cloudflare Pages 배포

이 저장소는 Cloudflare Pages용 정적 자산과 Pages Function 구성을 포함합니다.

- 정적 자산 디렉터리: `web`
- Pages Function 디렉터리: `functions`
- Wrangler 설정: `wrangler.jsonc`
- 목표 Pages 주소: `https://os-search.pages.dev`

Cloudflare 공식 문서 기준으로 Pages Functions는 `functions/` 아래 코드를 실행하고, 환경 변수는 Pages 프로젝트의 `Settings > Variables and Secrets`에서 주입합니다.
출처:
- Functions: https://developers.cloudflare.com/pages/functions/
- Variables and Secrets: https://developers.cloudflare.com/pages/functions/bindings/
- Wrangler configuration: https://developers.cloudflare.com/pages/functions/wrangler-configuration/

Pages 프로젝트 설정:

- Project name: `os-search`
- Production branch: `main`
- Build command: 비움
- Build output directory: `web`

Pages 환경 변수:

- `CLIENT_ID`
- `CLIENT_SECRET`
- `REQUEST_TIMEOUT`
- `LOG_LEVEL`

### 웹 API

- `POST /api/eox-search`
  - software release 기반 EoX 조회
- `POST /api/os-recommend`
  - PID 기반 권장 OS + EoX 조회
- `POST /api/hardware-search`
  - Product ID / Serial Number 기반 하드웨어 EoX 조회

### 하드웨어 검색 API

- `POST /api/hardware-search`
- `lookupType: "serial" | "pid"`
- `values: 쉼표 또는 줄바꿈 구분 입력`

하드웨어 검색은 Cisco EoX API를 사용합니다.
출처: https://developer.cisco.com/docs/support-apis/eox/

- Get EoX by Product ID(s): `GET /supporttools/eox/rest/5/EOXByProductID/{pageIndex}/{productID}`
- Get EoX by Serial Number(s): `GET /supporttools/eox/rest/5/EOXBySerialNumber/{pageIndex}/{serialNumber}`

문서 기준 입력 제한:

- Product ID: 최대 20개, 콤마 구분
- Serial Number: 최대 20개, 콤마 구분
- `responseencoding=json` 사용

Wrangler로 직접 배포하는 경우:

```bash
npx wrangler pages deploy
```

GitHub 연동 Pages 프로젝트라면 `main` 브랜치 푸시만으로도 production 배포가 갱신됩니다.

## 동작 개요

### 1. PID 기준 조회

1. 입력 PID를 쉼표 기준으로 정리하고 중복 제거
2. Software Suggestion API의 no-images releases endpoint로 권장 릴리스 조회
3. `isSuggested == "Y"` 후보만 남김
4. 후보가 여러 개면 아래 규칙으로 1개 선택
   - `releaseDate` 최신 우선
   - 보조 기준: `releaseFormat2`
5. 선택된 릴리스와 OS 타입을 사용해 EoX API 조회
6. 기본 만료일은 `LastDateOfSupport` 출력

### 2. OS 기준 조회

1. 입력 OS 버전을 쉼표 기준으로 정리하고 중복 제거
2. EoX API의 software release 조회 사용
3. EoX 응답에 여러 PID가 매핑되면 `LastDateOfSupport`가 가장 많이 나타나는 값을 대표값으로 선택
4. 기본 만료일은 `LastDateOfSupport` 출력

주의:

- Bash 계열 셸에서는 `10.3(6)`처럼 괄호가 있는 release를 반드시 따옴표로 감싸야 합니다.
- 예: `python -m src.cli os "10.3(6)"`

## 예외 처리

다음 상황을 구분해 표시합니다.

- 인증 실패
- 권한 없음
- 지원되지 않는 장비
- 추천 OS 없음
- EoX 결과 없음
- EoX 결과 다수
- API 타임아웃
- 응답 파싱 실패
- 입력 형식 오류

## 주의 사항

- Cisco Support API는 고객 권한과 앱 권한이 모두 맞아야 정상 동작합니다.
- EoX `Get EoX by Software Release String(s)`는 문서상 `input1`~`input20` 조합을 허용합니다.
- 문서상 일부 응답 예시는 축약되어 있어, 실제 운영 환경에서는 `--debug`로 필드 구조를 먼저 검증하는 것이 안전합니다.
- OS 타입 문자열은 [src/utils/os_mapper.py](src/utils/os_mapper.py)에 모아 두었습니다.
- Cisco 문서상 불명확한 지점은 코드에 `TODO`로 남겼습니다.

## 프로젝트 구조

```text
OS_Search/
  README.md
  requirements.txt
  .env.example
  src/
    __init__.py
    auth.py
    cli.py
    config.py
    errors.py
    models.py
    clients/
      __init__.py
      eox.py
      software_suggestion.py
    services/
      __init__.py
      eox_lookup_service.py
      recommendation_service.py
    utils/
      __init__.py
      batching.py
      formatter.py
      os_mapper.py
      parser.py
```
