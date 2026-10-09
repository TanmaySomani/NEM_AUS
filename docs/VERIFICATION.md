# Verification

Verified locally on 10 October 2026 (Australia/Brisbane).

- Production build: TypeScript checks and Vite static build pass.
- Formatting: Prettier check passes.
- Analysis utilities: 11 tests pass, including negative prices, missing data, aggregation, inclusive dates, Australian seasons, spike thresholds, episode continuity, forecast pairing and causal smoothing boundaries.
- Python pipeline/artifacts: 7 tests pass, including solar deduplication, six-observation price bins, UTC-to-AEST weather conversion, regular time grid, future-information exclusion, held-out-only predictions and agreement between published metrics and exported observations.
- Shared Python analysis: 6 tests pass for inclusive dates, Australian seasons, aggregation, negative prices, episode continuity, causal smoothing, forecast pairing and CSV semantics.
- Native Streamlit dashboard: 3 AppTest scenarios pass, covering every view, Gaussian smoothing, an empty season, reset callbacks and restoring the full test period. The local browser renders real Plotly charts, filters and event tables.
- Research notebooks: all four execute in fresh Python kernels, with 20 executed code cells and no error outputs. The forecasting notebook retrains the models and reproduces the published benchmark within the documented tolerance.
- Dependencies: npm installation/audit reports zero known vulnerabilities after updating the test runner.
- Browser: all four views render, with ECharts canvases and real data.
- Interactions: verified date edits, reversed-date validation, presets, season selection and empty state, smoothing method/strength, forecast baseline/reference, out-of-test-range prompt, event details and Escape, CSV export and share URL.
- Export: the 25 June–24 July 2024 selection downloads a rectangular CSV containing 1,423 half-hour observations and 13 named columns. Its dates and row count match the selected data.
- Responsive: checked a 390 × 844 phone viewport and the desktop preview. Phone document width equals viewport width; the episode table scrolls inside its container. Temporary viewport overrides were reset afterward.
- Original material: raw CSVs and academic PDFs are unchanged. All nine notebooks moved to `archive/notebooks/` match their original Git versions byte-for-byte.

CI is configured in `.github/workflows/checks.yml` to build and test React, run all 16 Python tests and execute all four notebooks.
