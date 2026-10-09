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

GitHub Actions [run #1](https://github.com/TanmaySomani/NEM_AUS/actions/runs/37949596526) passed on the rebuild commit `8d6f4fa` in 1 minute 24 seconds, including notebook execution on Linux.

The dashboard is published at [nem-observatory.streamlit.app](https://nem-observatory.streamlit.app/), deploying `main` / `streamlit_app.py` with Python 3.12. Cloud logs confirm dependency installation and startup. The hosted overview renders the same 1,423 default half-hours and $111.78/MWh mean as the local app.

All four hosted views were checked, including switching to centered Gaussian smoothing and inspecting the forecasting leaderboard and data audit. The hosted CSV download contains 1,423 rows and 13 columns, with explicit AEST timestamps from `2024-06-25T00:00` through `2024-07-24T15:00`.
