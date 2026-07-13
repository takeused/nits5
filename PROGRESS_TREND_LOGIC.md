# 기술 트렌드 로직 개선 기록

## 2026-07-13

- Trend result styling was aligned with the shared graphite/silver visual language: light header surface, neutral chart canvas, graphite line, silver bars, and subdued insight/detail panels.
- Chart.js axis, series, and grid colors were updated to preserve contrast on the new light canvas; no data or scoring logic was changed in this visual pass.
- Verification: `git diff --check`, `node --check js/chart.js`, and `node --test tests/browser-globals.test.js` pass (16 tests in the current focused suite).
- Calculation guidance was reconciled with the implementation: API-side year aggregation is documented as the primary path, sampled 500-record estimation as fallback, and the period is rendered dynamically instead of hard-coded to 2017~2025.
- Growth guidance now uses the same `성숙기` label and threshold wording as `classifyTrendPhase()`; yearly patent/paper ratios show `—` when the paper denominator is zero instead of a fabricated 999% value.
- Full regression suite after reconciliation: 34 tests passed.

- `getTrendPeriod()`로 최신 완결 연도 기준 10개년 기간을 동적으로 계산한다.
- `summarizeTrendQuality()`를 추가해 `ok/partial/error/empty`, 표본 커버리지, 연도 완결성, 추정 여부를 분리한다.
- ScienceON `PY` 연도 필터를 사용한 직접 집계를 우선하고, 미지원 시 기존 페이지 표본 집계를 추정·부분 상태로 표시한다.
- 0건·무연도·부분 오류에서는 `classifyTrendPhase()`가 성장 단계를 강제로 만들지 않도록 했다.
- 특허/논문 비율을 전환율이 아닌 색인 기반 탐색 신호로 라벨링하고, 추정 상태를 인사이트에 표시한다.
- 실행 결과 카드·로딩 화면을 공통 graphite UI 표면으로 통합했다.
- 검증: 전체 테스트 33개 통과, `js/chart.js`·`js/ui.js` 구문 검사 통과.
