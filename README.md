# NEM Observatory

An interactive NSW electricity-market dashboard rebuilt from the NEM_AUS research project. Explore spot prices, demand, rooftop solar, Sydney weather, high-price episodes and chronological forecasting benchmarks.

**Coverage:** 1 January 2022–24 July 2024 · NSW1 only · AEST (UTC+10) · AUD/MWh.

**[Open the live Streamlit dashboard](https://nem-observatory.streamlit.app/)** · [Automated checks](https://github.com/TanmaySomani/NEM_AUS/actions/workflows/checks.yml)

## Run the Streamlit dashboard

Use Python 3.12. The cleaned dataset and fitted-model predictions are included, so viewing the dashboard does not retrain the models or need credentials.

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m streamlit run streamlit_app.py
```

Open http://localhost:8501. The native Streamlit app uses Plotly for interactive charts and shares its analysis functions with the notebooks. It supports date and season filters, chart resolution, spike thresholds, event inspection, smoothing, forecast comparisons, CSV downloads and shareable filter URLs.

For Streamlit Community Cloud, deploy this repository's `main` branch with `streamlit_app.py` as the entry point and Python 3.12. Dependencies and theme configuration are committed; no secrets are required.

## Run the React dashboard

Requires Node.js 22.12 or newer. The cleaned data and benchmark are included; Python and model training are **not** required to view the app.

```bash
npm ci
npm run dev
```

Open the local URL shown by Vite (normally http://127.0.0.1:5173).

```bash
npm test
npm run build
npm run preview
```

The production dashboard is in `dist/`. It is a static application: serve this directory with any static web host. No credentials, external data service or application server is required. Do not open `index.html` directly as a file; it needs an HTTP server. For a subdirectory deployment, set Vite’s `base` to that subdirectory before building.

## What you can do

- **Market overview:** date and Australian-season filters; adjustable resolution and spike threshold; zoomable price, demand and solar charts; hourly price profile; event details.
- **Volatility lab:** trailing EMA or explicitly retrospective Gaussian smoothing; weekday/hour heatmap; temperature–price scatter plot; ranked high-price episodes.
- **Forecasting:** rolling next-half-hour regression and spike classification; actual-versus-predicted charts; persistence and seasonal baselines; validation feature importance; precision, recall, F1, average precision and confusion matrix.
- **Data & methods:** source inventory, coverage, missing values, timestamp assumptions, cleaning decisions and evaluation design.
- Export the selected half-hour observations and available test predictions to CSV. Share a URL containing the date range, season, view, threshold and chart resolution. The React version also preserves workbench settings. A local URL works only on the machine running the dashboard; use a hosted deployment URL for sharing with other people.

## Updated research notebooks

Four independently executable notebooks replace the exploratory fragments:

1. [Data quality](notebooks/01_data_quality.ipynb): audit source checksums, timestamp alignment, solar alternatives, missing values and feature causality.
2. [Market exploration](notebooks/02_market_exploration.ipynb): seasonal and hourly patterns, prices, demand, solar and recorded forecast diagnostics.
3. [Forecasting](notebooks/03_forecasting.ipynb): retrain both models, reproduce the chronological benchmark and compare against simple baselines.
4. [Volatility and smoothing](notebooks/04_volatility_and_smoothing.ipynb): inspect high-price episodes, compare causal and retrospective smoothing, and test threshold sensitivity.

Executed outputs are committed. The nine original notebooks are preserved byte-for-byte in [archive/notebooks](archive/notebooks), with their earlier paths retained in Git history.

```bash
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python scripts/execute_notebooks.py
.venv/bin/python -m unittest discover -s tests -v
```

Each notebook runs in a fresh kernel. The forecasting notebook retrains models on CPU and checks the published results; it writes model files only under ignored `artifacts/`. See [notebooks/README.md](notebooks/README.md) for details. CI executes the same notebooks and tests on every push.

## Rebuild the data and models

Requires Python 3.12 (recommended) or a compatible Python release with wheels for the pinned dependencies.

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm run data:build
npm run data:test
```

Without Node.js, run `.venv/bin/python scripts/build_data.py` directly.

`data:build` takes the five original CSVs from the repository root. It writes:

- `public/data/market.json`: the dashboard’s compact dataset, source checksums, quality audit and model metrics.
- `docs/benchmark.json`: readable evaluation results.
- `artifacts/models.joblib`: fitted scikit-learn models and ordered feature names (ignored by Git; regenerate when needed).

Training is deterministic for a fixed dependency/platform combination with random seed 42. Floating-point differences across platforms are possible. CPU execution is enough; no GPU or TensorFlow setup is needed. For resource-limited machines, set `OMP_NUM_THREADS=2` before running the build.

## If I started this project again

I would start with the data contract and evaluation question, then choose the model. The rebuilt project follows that order:

1. **Establish what each observation means.** Put electricity prices and half-hour demand on a regular interval-ending grid. Treat the solar measurement and satellite series as alternatives. Parse the weather’s UTC dates explicitly. Preserve missing values and disclose timestamp assumptions.
2. **Separate exploration from prediction.** Keep raw price extremes. Smoothing is a visual tool; centered Gaussian smoothing uses the future and must not enter a forecasting target or feature. It does not reduce actual market volatility.
3. **Set a forecast horizon and a test boundary.** Predict the next half-hour using earlier observed values. Fit on 2022–June 2023, select decisions on July–December 2023, refit on these two periods, then evaluate once on 2024. Never shuffle time or use the test set for early stopping.
4. **Make simple baselines the standard to beat.** Measure persistence, previous-day and previous-week prices before making claims about machine learning. Use error in AUD/MWh and rare-event metrics, rather than a generic forecasting “accuracy”.
5. **Choose dependable models before complex ones.** Gradient boosting and random forests create a fast, reproducible benchmark. Add an LSTM only if a properly controlled experiment demonstrates a useful improvement. The old notebook results are not presented as reproduced results.
6. **Build the product around questions.** Let a user explore prices, inspect spikes, compare forecasts, export evidence and understand limitations in one dashboard. Preserve the original notebooks in an archive and keep the raw CSVs unchanged as research history.

## What the new evaluation actually found

On 9,871 eligible half-hours in the untouched 2024 test period:

| Model | MAE (AUD/MWh) | RMSE (AUD/MWh) |
|---|---:|---:|
| Last interval | 41.643 | 385.487 |
| Gradient boosting | 45.032 | 550.877 |
| Previous day | 87.490 | 718.379 |
| Previous week | 105.441 | 793.464 |

**Persistence beats the trained regressor.** This is useful evidence, not a successful claim that machine learning outperforms a simple baseline. The dashboard makes it visible. The classifier is evaluated separately against half-hour price ≥ $300/MWh; the exploratory threshold selector does not retrain it.

## Project structure

```text
streamlit_app.py         Native Streamlit dashboard with Plotly charts
nem_analysis.py          Shared analysis for Streamlit and notebooks
notebooks/               Four executed, reproducible research notebooks
archive/notebooks/       Nine original notebooks, preserved unchanged
src/
  App.tsx                Four interactive dashboard views
  components/Chart.tsx   Apache ECharts integration and chart conventions
  lib/data.ts            Filtering, aggregation, smoothing, events and export
  lib/data.test.ts       Tests for market semantics and boundary conditions
  styles.css             Responsive layout and visual system
scripts/build_data.py    Source audit, cleaning, features, training and artifacts
scripts/execute_notebooks.py  Execute all notebooks in fresh kernels
tests/                  Pipeline, shared analysis and Streamlit interaction checks
public/data/market.json  Prebuilt dashboard data
docs/                    Methodology and reproducible evaluation results
```

## Boundaries

The supplied electricity files cover NSW only, despite the original project’s wider NEM ambition. This app does not invent observations for other regions. It uses historical data, not a live feed. CSV source publication times and issue times are incomplete, so this is an offline rolling backtest rather than an operationally validated trading system. All market timestamps are assumed to use AEST; the files themselves do not prove that. The dashboard is descriptive and predictive research, not causal evidence of price stabilisation.

The original academic documents and raw CSVs remain in place; the original notebooks are in `archive/notebooks/`. Data attribution follows the original project; source reuse/licensing rights must be checked before distributing the raw data separately.

See [docs/METHODOLOGY.md](docs/METHODOLOGY.md) for the complete data and model contract.
