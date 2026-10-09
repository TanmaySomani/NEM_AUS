"""Author the four canonical notebooks; archive the original exploratory notebooks.

Re-running preserves archived originals and recreates the canonical notebook source.
Use scripts/execute_notebooks.py to execute and save verified outputs afterward.
"""
from pathlib import Path
import hashlib
import nbformat as nbf

ROOT = Path(__file__).resolve().parents[1]
SETUP = '''from pathlib import Path
import sys
ROOT = next(p for p in [Path.cwd(), *Path.cwd().parents] if (p / 'nem_analysis.py').is_file())
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
import numpy as np
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from IPython.display import display
from nem_analysis import load_market, filter_market, aggregate_market, smooth_prices, price_episodes, score_forecasts, season_labels
market, metadata = load_market()
px.defaults.template = 'plotly_white'
px.defaults.color_discrete_sequence = ['#087e72', '#df9562', '#8296b0', '#233c35']
print(f"{len(market):,} half-hour positions | {market.index.min()}–{market.index.max()} | AEST (UTC+10)")'''


def write(name, cells):
    notebook = nbf.v4.new_notebook()
    notebook.metadata = {'kernelspec': {'display_name': 'Python 3', 'language': 'python', 'name': 'python3'},
                         'language_info': {'name': 'python', 'version': '3.12'}}
    notebook.cells = [nbf.v4.new_markdown_cell(text) if kind == 'md' else nbf.v4.new_code_cell(text) for kind, text in cells]
    for i, cell in enumerate(notebook.cells):
        cell['id'] = hashlib.sha256(f'{name}:{i}'.encode()).hexdigest()[:12]
    path = ROOT / 'notebooks' / name
    nbf.validate(notebook)
    nbf.write(notebook, path)

write('01_data_quality.ipynb', [
('md', '''# 01 · Data quality and the market-time contract

Start here. This notebook reproduces the data preparation behind both dashboards, checks source integrity, and makes missing values explicit. Run all cells in order from the repository root or the `notebooks/` directory.

**Setup:** `python3.12 -m venv .venv` then `.venv/bin/python -m pip install -r requirements-dev.txt`. Select that virtual environment as the notebook kernel. No GPU or TensorFlow is required.

Market times are assumed fixed AEST (UTC+10); weather explicitly labelled UTC is converted. Data covers NSW only, 1 January 2022–24 July 2024. [Methodology](../docs/METHODOLOGY.md) · [Original notebooks](../archive/notebooks/README.md).'''),
('code', SETUP),
('md', '## Source inventory\nThe duplicate solar timestamps are alternative production estimates, not extra generation. The premerged CSV is intentionally excluded.'),
('code', "display(pd.DataFrame(metadata['quality']['sources']))\ndisplay(pd.DataFrame(metadata['quality']['missing'].items(), columns=['channel', 'missing_half_hours']))"),
('md', '## Recreate the cleaned grid from the raw files\nEach half-hour price averages exactly six five-minute observations in `(t − 30 minutes, t]`. Incomplete intervals remain missing. Weather carry-forward is limited to one hour. No price clipping or backward filling occurs.'),
('code', "from scripts.build_data import prepare_data, make_features\ncleaned, audit = prepare_data()\nassert cleaned.index.is_unique and cleaned.index.is_monotonic_increasing\nassert cleaned.index.to_series().diff().dropna().eq(pd.Timedelta('30min')).all()\nassert len(cleaned) == len(market)\nnp.testing.assert_allclose(cleaned.price, market.price, atol=.00051, equal_nan=True)\nprint('Raw preparation agrees with the published dashboard artifact.')\ndisplay(cleaned.head(8))"),
('md', '## Check source hashes and timestamp alignment'),
('code', "import hashlib\nfor source in audit['sources']:\n    assert hashlib.sha256((ROOT / source['file']).read_bytes()).hexdigest() == source['sha256']\nassert np.isnan(cleaned.iloc[0].price), 'The first partial price bin must remain missing.'\nassert cleaned.loc['2022-01-01 01:00', 'temperature'] == 21.7\nassert audit['solarAlternativesResolved'] == 44844\nprint('Source checksums, incomplete-bin handling, UTC conversion and solar alternatives checked.')"),
('md', '## A direct test for future-information leakage\nChanging every observed value at and after an origin must not change any feature available at that origin.'),
('code', "features = make_features(cleaned)\nchanged = cleaned.copy()\norigin = pd.Timestamp('2023-06-01 12:00')\nchanged.loc[origin:, ['price','demand','solar','temperature']] = 999999\npd.testing.assert_frame_equal(features.loc[:origin], make_features(changed).loc[:origin])\nprint('All features at the origin depend on prior observations or known calendar values.')\ndisplay(features.loc[origin].to_frame('feature_value'))"),
('md', '## What remains uncertain\nThe source exports omit electricity timezone declarations and publication/forecast issue times. AEST is an explicit assumption, not proof of provenance. This is descriptive research and a nominal rolling backtest, not a verified operational replay. Proceed to [02 · Market exploration](02_market_exploration.ipynb).')
])

write('02_market_exploration.ipynb', [
('md', '''# 02 · Explore the NSW electricity market

Prices, operational demand, rooftop solar and Sydney temperature. Every analysis uses the same cleaned artifact as the dashboards. Chart aggregation is for presentation; summary metrics use half-hours. Negative prices and extremes remain in the analysis.'''),
('code', SETUP),
('md', '## Price distributions and Australian seasons'),
('code', "explore = market.assign(season=season_labels(market.index), year=market.index.year)\nseasonal = explore.groupby('season').agg(observations=('price','count'), mean_price=('price','mean'), median_price=('price','median'), peak_price=('price','max'), mean_demand_MW=('demand','mean'), mean_solar_MW=('solar','mean'))\ndisplay(seasonal.reindex(['Summer','Autumn','Winter','Spring']).round(2))\ndisplay(explore.groupby('year').price.agg(['count','mean','median','min','max']).round(2))"),
('md', '## Price, demand and solar over time\nDaily means can conceal short extremes. Use the dashboard’s five-minute peak overlay and event explorer to inspect them.'),
('code', "from plotly.subplots import make_subplots\ndaily, _ = aggregate_market(market, 'Daily')\nfig = make_subplots(rows=2, cols=1, shared_xaxes=True, vertical_spacing=.13, subplot_titles=['Spot price · daily average', 'Demand and rooftop solar · daily average'])\nfig.add_trace(go.Scatter(x=daily.index, y=daily.price, name='Spot price', line_color='#087e72'),row=1,col=1)\nfor column, label, color in [('demand','Operational demand','#233c35'),('solar','Rooftop solar','#df9562')]:\n    fig.add_trace(go.Scatter(x=daily.index,y=daily[column],name=label,line_color=color),row=2,col=1)\nfig.update_yaxes(title_text='AUD/MWh',row=1,col=1);fig.update_yaxes(title_text='MW',row=2,col=1)\nfig.update_xaxes(title_text='AEST (UTC+10)',row=2,col=1)\nfig.update_layout(template='plotly_white',height=650,hovermode='x unified')\nfig.show(renderer='plotly_mimetype')"),
('md', '## The daily rhythm\nHourly price means include extremes. This is an association, not evidence that the hour itself causes high prices.'),
('code', "profile = market.groupby(market.index.hour).agg(price=('price','mean'), demand=('demand','mean'), solar=('solar','mean'))\nfig = px.bar(profile.reset_index(),x='time',y='price',labels={'time':'Hour · AEST','price':'Mean AUD/MWh'},title='Average price by hour')\nfig.show(renderer='plotly_mimetype')\ndisplay(profile.round(2))"),
('md', '## Recorded demand forecasts and weather\nThe recorded POE50 forecast is descriptive only: issue times are missing, so it is excluded from the predictive feature set. Temperature correlations do not establish a causal relationship.'),
('code', "demand_error = (market.forecastDemand - market.demand).dropna()\ndisplay(pd.Series({'recorded_demand_forecast_MAE_MW': demand_error.abs().mean(), 'recorded_demand_forecast_bias_MW': demand_error.mean(), 'negative_price_share': market.price.dropna().lt(0).mean(), 'half_hour_spike_share_at_300': market.price.dropna().ge(300).mean()}).to_frame('value'))\ndisplay(market[['price','demand','solar','temperature']].corr().round(3))"),
('md', '## Continue\n[03 · Forecasting benchmarks](03_forecasting.ipynb) separates exploratory relationships from features available before a forecast is made.')
])

write('03_forecasting.ipynb', [
('md', '''# 03 · Reproduce the chronological forecasting benchmark

This notebook trains the canonical regressor and classifier from scratch using the shared pipeline. It does **not** reuse the old notebooks’ accuracy claims.

**Task:** predict the next half-hour mean using lagged observed history. Train before July 2023, choose loss/cutoff on July–December 2023, refit and freeze before scoring 2024. Test observations become lagged history for subsequent one-step predictions; models are not retrained during test. No operational publication-latency claim is made.'''),
('code', SETUP),
('md', '## Rebuild the experiment\nTwo gradient-boosting losses are compared on validation MAE. Random-forest spike classification uses a fixed target of price ≥ $300/MWh, with the cutoff chosen by validation F1. This CPU experiment normally takes seconds to a few minutes depending on the machine.'),
('code', "from scripts.build_data import prepare_data, benchmark\ncleaned, _ = prepare_data()\nfrom threadpoolctl import threadpool_limits\nwith threadpool_limits(limits=2):\n    predictions, result = benchmark(cleaned)\nleaderboard = pd.DataFrame(result['models']).sort_values('mae').reset_index(drop=True)\ndisplay(leaderboard)"),
('md', '## Validate the saved benchmark\nThe included artifact was generated with the pinned Python dependencies. Small floating-point differences across platforms are possible; material differences should be investigated rather than silently accepted.'),
('code', "published = pd.DataFrame(metadata['benchmark']['models']).set_index('name')\nreproduced = leaderboard.set_index('name')\ncomparison = reproduced[['mae','rmse','bias']].join(published[['mae','rmse','bias']],rsuffix='_published')\ndisplay(comparison)\nassert result['test']['count'] == metadata['benchmark']['test']['count']\nassert predictions.loc[predictions.index < '2024-01-01','prediction'].isna().all()\nassert result['train']['end'] < result['validation']['start'] < result['test']['start']\nfor name in reproduced.index:\n    np.testing.assert_allclose(reproduced.loc[name,['mae','rmse']].to_numpy(dtype=float), published.loc[name,['mae','rmse']].to_numpy(dtype=float), rtol=.001, atol=.01)\nprint('Chronology and published results reproduced within the documented tolerance.')"),
('md', '## Compare actual prices with forecasts\nThe chart uses daily means for legibility. MAE and RMSE above use original paired half-hours.'),
('code', "tested = cleaned.join(predictions).dropna(subset=['prediction'])\ndaily, _ = aggregate_market(tested,'Daily')\nfig = go.Figure()\nfor column,label,color in [('price','Observed','#233c35'),('prediction','Gradient boosting','#087e72'),('persistence','Last interval','#df9562')]:\n    fig.add_trace(go.Scatter(x=daily.index,y=daily[column],name=label,line_color=color))\nfig.update_layout(template='plotly_white',height=420,yaxis_title='Daily mean AUD/MWh',xaxis_title='Test interval ending · AEST',hovermode='x unified')\nfig.show(renderer='plotly_mimetype')"),
('md', '## Rare-event classification and feature importance\nAccuracy alone is misleading for a rare class. Report precision, recall, F1, average precision and prevalence. Importance measures model dependence on validation, not causality.'),
('code', "classifier = result['classifier']\ndisplay(pd.Series({k: classifier[k] for k in ['precision','recall','f1','averagePrecision','prevalence','probabilityCutoff']}).to_frame('full_test_value'))\ndisplay(pd.DataFrame(classifier['confusion'],index=['Actual negative','Actual positive'],columns=['Predicted negative','Predicted positive']))\ndisplay(pd.DataFrame(result['importance']).head(10))"),
('md', '''## Interpretation and neural-network scope

The last-interval baseline wins on the full test period. Gradient boosting is not promoted as a proven improvement. Large RMSE reflects rare, very large misses retained in the raw target.

The legacy RNN/LSTM experiments are preserved in `archive/notebooks/LSTM.ipynb`. They are historical reference, not reproduced evidence. This rebuilt benchmark deliberately does not require TensorFlow or a GPU. A new LSTM experiment should use the same causal features, correctly aligned target sequences, separate train-only scaling and a **new untouched holdout**; repeatedly optimizing on this observed 2024 test would invalidate the test boundary.

The optional error reference in the dashboards is a fixed validation-residual width, not a calibrated prediction interval. See [the complete model contract](../docs/METHODOLOGY.md).''')
])

write('04_volatility_and_smoothing.ipynb', [
('md', '''# 04 · High-price episodes and smoothing

Explore real price extremes without deleting them. Smoothing is a descriptive transformation; it never changes the price target or proves that market volatility was reduced. The centered Gaussian filter uses future observations and is explicitly retrospective.'''),
('code', SETUP),
('md', '## Define events using an explicit economic threshold\nEpisodes join only contiguous half-hours whose mean is at least the threshold. Five-minute extremes can occur inside an otherwise lower-price half-hour.'),
('code', "threshold = 300\nevents = price_episodes(market, threshold)\ndisplay(events.head(15))\nprint(f'{len(events):,} episodes; {market.price.ge(threshold).sum():,} high-price half-hours; {market.price.dropna().lt(0).mean():.1%} negative-price half-hours.')"),
('md', '## Inspect the largest episode with its surrounding days'),
('code', "largest = events.iloc[0]\nwindow = filter_market(market, largest.start.date() - pd.Timedelta(days=1), largest.end.date() + pd.Timedelta(days=1))\nwindow = window.assign(ema=smooth_prices(window,'Trailing EMA',6), gaussian=smooth_prices(window,'Centered Gaussian',6))\nfig=go.Figure()\nfor column,label,color in [('price','Observed','#233c35'),('ema','Trailing EMA','#087e72'),('gaussian','Centered Gaussian · retrospective','#df9562')]:\n    fig.add_trace(go.Scatter(x=window.index,y=window[column],name=label,line_color=color,connectgaps=False))\nfig.add_hline(y=threshold,line_dash='dash',line_color='#8296b0')\nfig.update_layout(template='plotly_white',height=450,yaxis_title='AUD/MWh',xaxis_title='Interval ending · AEST',hovermode='x unified')\nfig.show(renderer='plotly_mimetype')"),
('md', '## Prove the EMA does not use future prices\nThe centered filter is allowed to change earlier values when future prices change, which is precisely why it is excluded from forecasting.'),
('code', "origin = window.index[len(window)//2]\nchanged = window.copy()\nchanged.loc[changed.index > origin,'price'] = 999999\noriginal_ema=smooth_prices(window,'Trailing EMA',6)\nchanged_ema=smooth_prices(changed,'Trailing EMA',6)\npd.testing.assert_series_equal(original_ema.loc[:origin],changed_ema.loc[:origin])\noriginal_gaussian=smooth_prices(window,'Centered Gaussian',6)\nchanged_gaussian=smooth_prices(changed,'Centered Gaussian',6)\nassert not np.allclose(original_gaussian.loc[:origin].fillna(0),changed_gaussian.loc[:origin].fillna(0))\nprint('EMA passes the future perturbation test. Centered Gaussian correctly demonstrates future dependence.')"),
('md', '## Sensitivity to the exploratory threshold\nChanging a threshold alters an event definition. It does not retrain the fixed $300/MWh classifier.'),
('code', "sensitivity=[]\nfor limit in [100,300,1000,5000]:\n    sensitivity.append({'threshold_AUD_MWh':limit,'high_half_hours':int(market.price.ge(limit).sum()),'episodes':len(price_episodes(market,limit))})\ndisplay(pd.DataFrame(sensitivity))\nassert price_episodes(market,5000).peak_price.ge(5000).all()"),
('md', '## Use the dashboard\nRun `.venv/bin/python -m streamlit run streamlit_app.py` to explore these analyses interactively. The React/ECharts interface is also available with `npm run dev`. Both consume the same checked data artifact and preserve unsmoothed targets.')
])

archive = ROOT / 'archive' / 'notebooks'
archive.mkdir(exist_ok=True, parents=True)
for original in ROOT.glob('*.ipynb'):
    target = archive / original.name
    if target.exists():
        raise FileExistsError(f'Refusing to overwrite an existing archive: {target}')
    original.rename(target)
print('Created four canonical notebooks and retained historical notebooks in archive/notebooks/.')
