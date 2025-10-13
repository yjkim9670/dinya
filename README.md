# 한국 증시 모니터링 대시보드

GitHub Pages로 배포되는 대시보드로, Notion 다크 테마 감성의 인터페이스 안에서 삼성전자·SK하이닉스와 TIGER S&P500·TIGER 나스닥100을 모니터링합니다. 최근 10영업일의 일별 가격 흐름, RSI·스토캐스틱·MACD 지표와 매매 시그널, 관련 뉴스를 자동으로 수집해 시각화합니다.

## 주요 기능

- **분류 탭**: 상단 탭에서 `국내 대표주(삼성전자·SK하이닉스)`와 `글로벌 ETF(TIGER S&P500·TIGER 나스닥100)`를 전환합니다.
- **Notion 다크 테마 UI**: 차분한 다크 팔레트와 카드형 레이아웃으로 지표와 뉴스를 균형 있게 배치했습니다.
- **최근 10영업일 차트**: 일별 종가 라인 차트에 이동평균, 지표 수치를 함께 확인할 수 있는 카드가 제공됩니다.
- **기술적 지표 요약**: RSI, 스토캐스틱, MACD 값을 계수와 함께 표시하고, 조건에 맞는 매수·매도·중립 시그널을 태그로 요약합니다.
- **뉴스 피드**: yfinance 뉴스가 비어 있을 경우 야후 파이낸스 검색 API를 이용해 보조 데이터를 가져와 안정적으로 기사 링크를 제공합니다.

## 표시되는 기술적 지표

| 지표 | 파라미터 | 해석 기준 |
| --- | --- | --- |
| 단순 이동평균 (SMA) | 5일, 20일 | 5일선이 20일선 위면 상승 추세 |
| RSI | 기간 14 | 30 이하 매수 우위, 70 이상 매도 우위 |
| 스토캐스틱 Slow | %K(14, 3), %D(3) | %K ≤ 20 매수, %K ≥ 80 매도, K/D 교차 확인 |
| MACD | EMA(12, 26) + Signal 9 | MACD > Signal 시 상승 모멘텀 |

## 디렉터리 구조

```text
.
├── AGENTS.md                      # 저장소 편집 지침 (Notion 다크 테마 유지)
├── README.md                      # 프로젝트 설명 (본 문서)
├── assets/
│   ├── app.js                     # 프런트엔드 로직, 탭/지표/시그널 구성
│   └── styles.css                 # Notion 다크 테마 스타일 정의
├── data/
│   ├── history/                   # 종목별 일별 CSV 누적(자동 생성)
│   └── latest.json                # 대시보드가 사용하는 최신 스냅샷
├── index.html                     # GitHub Pages 진입점
├── requirements.txt               # 데이터 수집 스크립트 의존성
└── scripts/
    └── fetch_market_data.py       # yfinance 기반 데이터 수집 및 지표 계산
```

## 데이터 수집과 자동화 흐름

1. `scripts/fetch_market_data.py`가 yfinance에서 최근 3개월 일별 데이터를 가져와 10영업일 가격 히스토리를 구성합니다.
2. 스크립트는 SMA(5·20), RSI(14), 스토캐스틱(14,3,3), MACD(12,26,9)을 계산하고 시그널을 도출합니다.
3. yfinance 뉴스가 비어 있으면 야후 파이낸스 검색 API를 이용해 최대 5건의 보조 뉴스로 채웁니다.
4. 결과는 `data/latest.json`과 `data/history/*.csv`에 저장되며, GitHub Actions 워크플로가 변경사항을 커밋합니다.
5. `.github/workflows/update-data.yml`이 매 정시(`0 * * * *`)마다 실행되어 데이터를 새로고침하고 GitHub Pages가 최신 JSON을 읽어 즉시 반영합니다.

> **유의사항**: GitHub Actions 스케줄과 데이터 제공 지연으로 완전한 실시간 반영은 불가능합니다. 더 촘촘한 주기가 필요하면 워크플로 크론 스케줄을 조정하되, API 호출 제한과 GitHub Actions 사용량을 고려하세요.

## GitHub Pages & Actions 운영 방법

1. **GitHub Actions 사용 설정**
   - 저장소 **Settings → Actions → General**에서 "Allow all actions and reusable workflows"가 선택되어 있는지 확인합니다.
   - 같은 화면의 **Workflow permissions**는 "Read and write permissions"으로 설정해야 자동 커밋이 가능합니다.
2. **GitHub Pages 배포 설정**
   - **Settings → Pages**에서 배포 브랜치를 `main`, 폴더를 `/ (root)`로 지정합니다.
   - Actions 워크플로가 `data/latest.json`을 갱신하면 Pages 정적 호스팅이 최신 데이터를 자동으로 사용합니다.
3. **초기 데이터 갱신**
   - 워크플로 페이지에서 `Update market data`를 수동으로 한 번 실행하거나 정시 스케줄을 기다립니다.
   - `data/history/` 디렉터리는 스크립트가 실행되면 자동으로 생성됩니다. Git이 추적할 수 있도록 빈 디렉터리가 필요하면 `.gitkeep`을 두어도 됩니다.
4. **환경 변수/비밀키**
   - 기본적으로 공개 API(yfinance)만 호출하므로 별도 시크릿이 필요하지 않습니다. 추가 데이터 소스를 연결할 경우 Actions 시크릿으로 관리하세요.

> **로컬 실행은 선택 사항**입니다. 저장소는 GitHub Actions만으로 운용되도록 설계되었지만, 필요 시 아래 절차로 수동 갱신이 가능합니다.
>
> ```bash
> pip install -r requirements.txt
> python scripts/fetch_market_data.py
> python -m http.server 8000
> ```
>
> `http://localhost:8000/index.html`에 접속하면 동일한 대시보드를 확인할 수 있습니다.

## 프런트엔드 편집 가이드

- **탭 구성**: `assets/app.js` 상단의 `CATEGORY_DEFINITIONS` 배열에 분류 이름과 종목 심볼을 정의합니다.
- **지표/시그널**: `createCard` 함수가 지표 그리드와 시그널 태그를 구성합니다. 데이터 스키마를 변경할 경우 `scripts/fetch_market_data.py`와 `data/latest.json`을 함께 수정하세요.
- **스타일 가이드**: `assets/styles.css`는 Notion 다크 테마 팔레트와 카드형 레이아웃을 정의합니다. 대비와 간결한 여백을 유지하며 수정하세요.
- **접근성**: 탭은 ARIA `tablist`/`tabpanel` 패턴을 사용합니다. 새로운 컴포넌트 추가 시 동일한 접근성 속성을 유지하세요.

## 유지보수 팁

- yfinance API 응답 구조가 변할 수 있으므로 오류 발생 시 `fetch_market_data.py`의 로그를 확인하세요.
- 자동 커밋 워크플로는 브랜치 보호 규칙과 충돌할 수 있습니다. 보호 규칙을 사용 중이라면 PR 기반 전략으로 전환을 검토하세요.
- 투자 의사결정 전에 반드시 공식 데이터 소스와 교차 검증하세요. 본 대시보드는 모니터링 참고용입니다.

## 라이선스

별도 라이선스가 명시되지 않은 자료는 사용자의 소유로 간주합니다.
