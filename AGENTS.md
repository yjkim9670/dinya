# Repository Instructions

- 문서와 코드 변경 시 **README.md**에 최신 흐름이 반영되었는지 확인하세요. README는 한글 전용으로 유지합니다.
- 프런트엔드 구조는 `index.html` + `assets/app.js` + `assets/styles.css`의 3단 구성을 따릅니다.
  - `assets/app.js` 상단의 `CATEGORY_DEFINITIONS`를 수정하면 분류 탭과 설명, 종목 구성이 바뀝니다.
  - 탭 인터페이스는 ARIA `tablist`/`tabpanel` 패턴을 사용하므로 접근성 속성을 지키며 수정하세요.
  - 스타일은 GitHub 다크 테마 팔레트를 확장한 것이므로 색상 변경 시 대비(contrast)를 고려합니다.
- 데이터 구조를 수정할 때는 `scripts/fetch_market_data.py`와 `data/latest.json` 스키마가 동기화되도록 유지하세요.
- 자동화 파이프라인을 변경할 경우 `.github/workflows/update-data.yml`과 관련 의존성 업데이트를 문서화하세요.
- 테스트나 정적 분석 도구를 실행한 경우, 실행한 명령을 PR/커밋 설명에 명시하세요.
