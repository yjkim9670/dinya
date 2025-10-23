# 한국 주식·ETF 트레이딩 콘솔

GitHub Pages로 배포되는 AdminLTE 스타일의 트레이딩 콘솔입니다. 삼성전자·SK하이닉스와 TIGER S&P500·TIGER 나스닥100을 추적하며, 기술적 지표 기반의 매매 추천 점수와 자동 모의투자 잔고를 함께 제공합니다. 최근 20거래일을 기본으로 최대 3개월(60거래일)까지 일별 가격 흐름을 살펴볼 수 있습니다.

## 주요 기능

- **AdminLTE 톤 UI**: 밝은 AdminLTE 계열 팔레트와 박스형 카드, 배지/뱃지 스타일을 적용했습니다. 폰트는 Source Sans Pro와 Noto Sans KR 조합을 사용합니다.
- **자동 모의투자 요약**: 상단 요약 카드에서 전체 자산·가용 현금·평가 금액·누적 손익과 초기 자본을 확인할 수 있습니다.
- **매매 추천 점수**: SMA, RSI, 스토캐스틱, MACD 시그널을 가중하여 0~100점의 추천 점수를 계산하고, 80점 이상은 `매수`, 20점 이하는 `매도` 배지로 표시합니다.
- **자동 매매 시뮬레이션**: 종목별 1,000만원의 초기 자본으로 시작해 추천 점수에 따라 잔고와 보유 수량을 자동 갱신합니다. 최근 체결 내역은 카드에 텍스트로 표시됩니다.
- **조절 가능한 차트 구간**: 슬라이더로 최근 20~60거래일(약 3개월) 범위를 즉시 조절하며, 20분 주기로 데이터가 새로 고쳐집니다.
- **기술적 지표·뉴스**: RSI·스토캐스틱·MACD 등 핵심 지표와 해석 태그, 관련 뉴스를 카드 내 섹션으로 정리했습니다.

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
├── AGENTS.md                      # 저장소 편집 지침
├── README.md                      # 프로젝트 설명 (본 문서)
├── assets/
│   ├── app.js                     # 프런트엔드 로직, 탭/지표/시그널 및 모의투자 카드 구성
│   └── styles.css                 # AdminLTE 톤 UI 스타일 정의
├── data/
│   ├── history/                   # 종목별 일별 CSV 누적(자동 생성)
│   ├── latest.json                # 대시보드가 사용하는 최신 스냅샷
│   └── portfolio.json             # 자동 모의투자 잔고 및 최근 조치(자동 생성)
├── index.html                     # GitHub Pages 진입점
├── requirements.txt               # 데이터 수집 스크립트 의존성
└── scripts/
    └── fetch_market_data.py       # yfinance 기반 데이터 수집·지표·모의투자 계산
```

## 데이터 수집과 자동화 흐름

1. `scripts/fetch_market_data.py`가 yfinance에서 최근 3개월 일별 데이터를 가져와 60거래일 분량의 차트 히스토리를 만듭니다.
2. SMA(5·20), RSI(14), 스토캐스틱(14,3,3), MACD(12,26,9)을 계산하고, 시그널 가중치로 추천 점수(0~100)를 산출합니다.
3. 추천 점수에 따라 종목별 모의투자 포트폴리오를 자동 갱신합니다. 80점 이상은 가능한 만큼 매수, 20점 이하는 전량 매도하며, 잔고는 `data/portfolio.json`에 저장됩니다.
4. `data/latest.json`에는 지표·시그널·추천 점수·모의투자 현황이 함께 기록되고, `data/history/*.csv`에는 전체 히스토리가 누적됩니다.
5. `.github/workflows/update-data.yml`이 매 정시(`0 * * * *`)마다 실행되어 JSON과 포트폴리오 파일을 갱신하면, 프런트엔드는 20분 주기로 최신 데이터를 다시 불러옵니다.

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
- **지표/시그널**: `createCard` 함수가 지표 그리드와 시그널 태그, 추천 점수 섹션을 구성합니다. 데이터 스키마를 변경할 경우 `scripts/fetch_market_data.py`와 `data/latest.json`을 함께 수정하세요.
- **차트 구간**: `DEFAULT_CHART_DAYS`, `MAX_CHART_DAYS` 상수를 조정하면 슬라이더 범위를 변경할 수 있습니다. 사용자 조작 값은 심볼별로 기억되므로 자동 새로고침 후에도 유지됩니다.
- **포트폴리오 요약**: `renderPortfolioOverview`와 `createPortfolioSection`이 `portfolio_summary` 및 `ticker.portfolio` 데이터를 사용합니다. JSON 구조를 바꾸면 두 함수를 함께 수정하세요.
- **스타일 가이드**: `assets/styles.css`는 AdminLTE 톤의 밝은 팔레트와 박스형 레이아웃을 정의합니다. 배지/버튼 색상 대비를 유지하면서 확장하세요.
- **뉴스 연동**: 스냅샷에 제목·링크가 없는 경우 카드에 안내 문구만 노출됩니다. 뉴스 데이터를 수집하려면 `fetch_market_data.py`에서 RSS(예: 네이버 금융) 또는 뉴스 API를 호출해 `ticker.news` 배열에 `title`, `publisher`, `link`, `published_at`을 채우세요.
- **접근성**: 탭은 ARIA `tablist`/`tabpanel` 패턴을 사용합니다. 새로운 컴포넌트 추가 시 동일한 접근성 속성을 유지하세요.

## 유지보수 팁

- yfinance API 응답 구조가 변할 수 있으므로 오류 발생 시 `fetch_market_data.py`의 로그를 확인하세요.
- 자동 커밋 워크플로는 브랜치 보호 규칙과 충돌할 수 있습니다. 보호 규칙을 사용 중이라면 PR 기반 전략으로 전환을 검토하세요.
- 투자 의사결정 전에 반드시 공식 데이터 소스와 교차 검증하세요. 본 대시보드는 모니터링 참고용입니다.

## 라이선스

별도 라이선스가 명시되지 않은 자료는 사용자의 소유로 간주합니다.
