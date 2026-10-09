"""Build the reproducible NSW data product and chronological forecasting benchmark.

The dashboard is static: it consumes only these real, precomputed artifacts.
Run from any directory with: .venv/bin/python scripts/build_data.py
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import time
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor, RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.inspection import permutation_importance
from sklearn.metrics import (mean_absolute_error, mean_squared_error, precision_score,
                             recall_score, f1_score, average_precision_score,
                             precision_recall_curve, confusion_matrix)
from sklearn.pipeline import make_pipeline
import joblib

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public' / 'data'
THRESHOLD = 300
SOURCES = ['nsw_prices.csv', 'nsw_demand_actual.csv', 'nsw_demand_forecast.csv', 'nsw_solar.csv', 'CCtemps.csv']


def read_source(name: str, date_col: str = 'date_time') -> pd.DataFrame:
    df = pd.read_csv(ROOT / name)
    df[date_col] = pd.to_datetime(df[date_col])
    return df.set_index(date_col).sort_index()


def prepare_data():
    raw = read_source('nsw_prices.csv')
    # A value labelled t summarizes (t-30min, t], preserving end-of-interval semantics.
    price = raw.RRP.resample('30min', closed='right', label='right').agg(['mean', 'count', 'max', 'min'])
    price.loc[price['count'] != 6, ['mean', 'max', 'min']] = np.nan
    demand = read_source('nsw_demand_actual.csv').OPERATIONAL_DEMAND
    forecast = read_source('nsw_demand_forecast.csv').OPERATIONAL_DEMAND_POE50
    solar = read_source('nsw_solar.csv', 'INTERVAL_DATETIME')
    # Two estimates of the same rooftop production are alternatives, never additive observations.
    measurements = solar[solar.TYPE == 'MEASUREMENT'].POWER
    satellite = solar[solar.TYPE == 'SATELLITE'].POWER
    solar_power = measurements.combine_first(satellite)
    weather = pd.read_csv(ROOT / 'CCtemps.csv')
    weather.index = pd.to_datetime(weather.valid_start_UTC, dayfirst=True, utc=True).dt.tz_convert('Etc/GMT-10').dt.tz_localize(None)
    temp = pd.to_numeric(weather['66214'], errors='coerce').sort_index()
    index = pd.date_range(demand.index.min(), min(demand.index.max(), raw.index.max()), freq='30min')
    df = pd.DataFrame(index=index)
    df['price'] = price['mean'].reindex(index)
    df['demand'] = demand.reindex(index)
    df['forecastDemand'] = forecast.reindex(index)
    df['solar'] = solar_power.reindex(index)
    # Only past observations, and no more than one hourly weather interval old.
    df['temperature'] = temp.reindex(index, method='ffill', tolerance=pd.Timedelta('1h'))
    df['maxPrice'] = price['max'].reindex(index)
    df['minPrice'] = price['min'].reindex(index)
    audit = []
    for name in SOURCES:
        original = pd.read_csv(ROOT / name)
        date_col = 'INTERVAL_DATETIME' if name == 'nsw_solar.csv' else 'valid_start_UTC' if name == 'CCtemps.csv' else 'date_time'
        audit.append({'file': name, 'rows': len(original), 'uniqueTimestamps': int(original[date_col].nunique()),
                      'sha256': hashlib.sha256((ROOT / name).read_bytes()).hexdigest()})
    quality = {'sources': audit, 'expectedIntervals': len(index), 'completePrices': int(df.price.notna().sum()),
               'solarAlternativesResolved': int(solar.index.duplicated().sum()),
               'missing': {c: int(df[c].isna().sum()) for c in df.columns},
               'rawPriceIntervals': len(raw), 'fiveMinuteSpikes': int((raw.RRP >= THRESHOLD).sum()),
               'weatherOffsetHours': 10, 'solarSatelliteFallbacks': int((measurements.isna() & satellite.reindex(measurements.index).notna()).sum()),
               'first': index.min().isoformat(), 'last': index.max().isoformat()}
    return df, quality


def make_features(df: pd.DataFrame) -> pd.DataFrame:
    x = pd.DataFrame(index=df.index)
    for lag in [1, 2, 48, 336]:
        x[f'price_lag_{lag}'] = df.price.shift(lag)
    for window in [6, 48]:
        x[f'price_mean_{window}'] = df.price.shift(1).rolling(window, min_periods=window).mean()
    for name in ['demand', 'solar', 'temperature']:
        x[f'{name}_lag_1'] = df[name].shift(1)
    hour = df.index.hour + df.index.minute / 60
    x['hour_sin'] = np.sin(2 * np.pi * hour / 24)
    x['hour_cos'] = np.cos(2 * np.pi * hour / 24)
    x['weekday_sin'] = np.sin(2 * np.pi * df.index.dayofweek / 7)
    x['weekday_cos'] = np.cos(2 * np.pi * df.index.dayofweek / 7)
    x['month_sin'] = np.sin(2 * np.pi * df.index.month / 12)
    x['month_cos'] = np.cos(2 * np.pi * df.index.month / 12)
    return x


def regression_metrics(y, pred):
    return {'mae': round(float(mean_absolute_error(y, pred)), 3),
            'rmse': round(float(np.sqrt(mean_squared_error(y, pred))), 3),
            'bias': round(float(np.mean(pred - y)), 3)}


def benchmark(df: pd.DataFrame):
    x = make_features(df)
    eligible = df.price.notna() & x[['price_lag_1', 'price_lag_2', 'price_lag_48', 'price_lag_336', 'price_mean_48']].notna().all(axis=1)
    train = eligible & (df.index < '2023-07-01')
    valid = eligible & (df.index >= '2023-07-01') & (df.index < '2024-01-01')
    test = eligible & (df.index >= '2024-01-01')
    y = df.price
    candidates = {}
    fitted = {}
    for loss in ['absolute_error', 'squared_error']:
        print(f'Training gradient boosting ({loss})...', flush=True)
        model = HistGradientBoostingRegressor(loss=loss, max_iter=160, max_leaf_nodes=15, learning_rate=.06,
                                              l2_regularization=8, min_samples_leaf=40, early_stopping=False, random_state=42)
        model.fit(x[train], y[train])
        fitted[loss] = model
        candidates[loss] = regression_metrics(y[valid], model.predict(x[valid]))
    chosen = min(candidates, key=lambda key: candidates[key]['mae'])
    model = fitted[chosen]
    residual_width = float(np.quantile(np.abs(model.predict(x[valid]) - y[valid]), .8))
    importance = permutation_importance(model, x[valid], y[valid], scoring='neg_mean_absolute_error', n_repeats=3, max_samples=2000, random_state=42)
    ranking = sorted([{'feature': k, 'importance': round(float(v), 3)} for k, v in zip(x.columns, importance.importances_mean)], key=lambda r: r['importance'], reverse=True)
    model.fit(x[train | valid], y[train | valid])
    pred = model.predict(x[test])
    forecasts = pd.DataFrame(index=df.index)
    forecasts['prediction'] = np.nan
    forecasts.loc[test, 'prediction'] = pred
    forecasts['persistence'] = x.price_lag_1.where(test)
    forecasts['previousDay'] = x.price_lag_48.where(test)
    forecasts['previousWeek'] = x.price_lag_336.where(test)
    models = [{'name': 'Gradient boosting', **regression_metrics(y[test], pred)},
              {'name': 'Last interval', **regression_metrics(y[test], x.loc[test, 'price_lag_1'])},
              {'name': 'Previous day', **regression_metrics(y[test], x.loc[test, 'price_lag_48'])},
              {'name': 'Previous week', **regression_metrics(y[test], x.loc[test, 'price_lag_336'])}]
    print('Training price-spike classifier...', flush=True)
    labels = (y >= THRESHOLD).astype(int)
    classifier = make_pipeline(SimpleImputer(strategy='median'), RandomForestClassifier(
        n_estimators=140, max_depth=12, min_samples_leaf=12, class_weight='balanced_subsample', n_jobs=2, random_state=42))
    classifier.fit(x[train], labels[train])
    prob_valid = classifier.predict_proba(x[valid])[:, 1]
    precision, recall, thresholds = precision_recall_curve(labels[valid], prob_valid)
    fs = 2 * precision[:-1] * recall[:-1] / np.maximum(precision[:-1] + recall[:-1], 1e-10)
    cutoff = float(thresholds[np.argmax(fs)])
    classifier.fit(x[train | valid], labels[train | valid])
    risk = classifier.predict_proba(x[test])[:, 1]
    forecasts['risk'] = np.nan
    forecasts.loc[test, 'risk'] = risk
    binary = risk >= cutoff
    summary = {'train': {'start': str(df.index[train].min()), 'end': str(df.index[train].max()), 'count': int(train.sum())},
               'validation': {'start': str(df.index[valid].min()), 'end': str(df.index[valid].max()), 'count': int(valid.sum())},
               'test': {'start': str(df.index[test].min()), 'end': str(df.index[test].max()), 'count': int(test.sum())},
               'horizonMinutes': 30, 'chosenLoss': chosen, 'candidates': candidates, 'models': models, 'importance': ranking,
               'bandWidth': round(residual_width, 3), 'bandTestCoverage': round(float(np.mean(np.abs(pred - y[test]) <= residual_width)) * 100, 2),
               'classifier': {'threshold': THRESHOLD, 'probabilityCutoff': round(cutoff, 4),
                   'precision': float(precision_score(labels[test], binary, zero_division=0)),
                   'recall': float(recall_score(labels[test], binary, zero_division=0)),
                   'f1': float(f1_score(labels[test], binary, zero_division=0)),
                   'averagePrecision': float(average_precision_score(labels[test], risk)),
                   'prevalence': float(labels[test].mean()), 'confusion': confusion_matrix(labels[test], binary).tolist()},
               'features': list(x.columns), 'seed': 42}
    artifacts = ROOT / 'artifacts'
    artifacts.mkdir(exist_ok=True)
    joblib.dump({'regressor': model, 'classifier': classifier, 'features': list(x.columns), 'probabilityCutoff': cutoff}, artifacts / 'models.joblib')
    return forecasts, summary


def main():
    start = time.time()
    OUT.mkdir(exist_ok=True, parents=True)
    df, quality = prepare_data()
    forecasts, summary = benchmark(df)
    combined = df.join(forecasts)
    columns = list(combined.columns)
    # Compact columnar schema. Missing stays null, never zero or a future observation.
    rows = []
    for stamp, values in zip(combined.index, combined.to_numpy()):
        rows.append([stamp.strftime('%Y-%m-%dT%H:%M'), *[None if not np.isfinite(v) else round(float(v), 3) for v in values]])
    payload = {'schemaVersion': 1, 'region': 'NSW1', 'timezone': 'AEST (UTC+10)', 'intervalMinutes': 30,
               'columns': ['time', *columns], 'rows': rows, 'quality': quality, 'benchmark': summary}
    (OUT / 'market.json').write_text(json.dumps(payload, separators=(',', ':'), allow_nan=False))
    (ROOT / 'docs' / 'benchmark.json').write_text(json.dumps(summary, indent=2, allow_nan=False))
    print(json.dumps({'rows': len(rows), 'sizeMB': round((OUT / 'market.json').stat().st_size / 1e6, 2), 'seconds': round(time.time()-start), 'models': summary['models']}, indent=2), flush=True)

if __name__ == '__main__':
    main()
