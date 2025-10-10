# Conversation Intelligence Dashboard

카카오톡 오픈채팅방의 원본 대화(`kakaotalk_conversation.txt`)를 정적 HTML 대시보드로 시각화한 프로젝트입니다. 대화 전문과 분석 리포트를 HTML 파일에 직접 내장해 “복사 불가” 제약이 있는 환경에서도 원문과 인사이트를 동시에 검토할 수 있습니다.

## 핵심 구성 요소

| 파일 | 설명 |
| --- | --- |
| `index.html` | 날짜별 발화량과 KOSPI·S&P500 지표를 결합한 복합 그래프, 시간대 히트맵, 시간대/참여자/키워드 분석, 심층 리포트 요약을 한 화면에서 확인할 수 있는 메인 대시보드 |
| `conversation_full.html` | 카카오톡 대화 원문을 그대로 내장한 열람 페이지 (검색/스크롤 가능) |
| `insights.html` | `conversation_insights.md` 내용을 HTML로 변환한 서사형 분석 리포트 |
| `data/conversation_metrics.json` | 파싱된 메시지를 기반으로 산출한 요약 지표, 날짜·시간대별 집계, 키워드, 참여자 통계 |
| `data/market_indices.json` | 대화 기간과 매칭되는 KOSPI/S&P500 종가 및 변동률 샘플 데이터 |
| `data/datasets.js` | 대시보드에서 바로 사용할 수 있도록 주요 데이터를 전역 상수로 번들링한 스크립트 |
| `scripts/build_data.mjs` | 원본 텍스트/리포트를 파싱해 위 데이터 및 HTML 아카이브 파일을 생성하는 빌드 스크립트 |

## 사용 방법

1. **데이터 빌드**
   ```bash
   node scripts/build_data.mjs
   ```
   위 명령은 텍스트 로그를 파싱해 `data/*.json`, `data/datasets.js`, `conversation_full.html`, `insights.html`을 자동 생성/갱신합니다.

2. **대시보드 열기**
   - `index.html`을 브라우저에서 열면 그래프가 자동으로 렌더링됩니다.
   - 사이드바 링크를 통해 원문 전문(`conversation_full.html`)과 심층 리포트(`insights.html`)를 새 탭에서 확인할 수 있습니다.

3. **데이터 업데이트**
   - 새로운 카카오톡 로그로 교체한 뒤 `node scripts/build_data.mjs`를 다시 실행하면 모든 통계/그래프가 최신 상태로 갱신됩니다.
   - 필요 시 `scripts/build_data.mjs`의 불용어 목록, 키워드 상위 개수, 주가지수 생성 로직 등을 조정해 맞춤형 분석을 구현할 수 있습니다.

## 구현 특징

- **원문 완전 보존**: 대화 전문을 별도 HTML로 저장하고 대시보드에서 프리뷰/링크를 제공하여 복사 제약 없이 참조할 수 있습니다.
- **다중 시각화**: 날짜별 발화 vs 주가지수 복합 그래프, 날짜×시간 히트맵, 시간대 누적 추이, 참여자 상위 리스트, 키워드 트리맵/타임라인을 포함합니다.
- **접근성 고려**: 명도 대비가 높은 다크 테마, 반응형 레이아웃, 그래프에 대한 aria-label 제공 등으로 다양한 환경에서 열람 가능하도록 구성했습니다.
- **오프라인 활용성**: 모든 연산과 렌더링이 브라우저 내부에서 수행되며, 외부 네트워크 요청 없이 동작합니다 (CDN 차트 스크립트 제외).

## 참고

- `bagajin_infographic.html`은 특정 참여자 중심의 별도 인포그래픽 예시로, 메인 대시보드와 독립적으로 열람할 수 있습니다.
- 프로젝트를 확장해 추가 지표(예: 감성 분석, 답변 지연 시간)를 계산하려면 `scripts/build_data.mjs`에 파싱 로직을 보강하고, `data/datasets.js`에 필요한 필드를 포함시키면 됩니다.

