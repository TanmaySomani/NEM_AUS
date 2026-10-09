"""Shared, tested analysis for the Streamlit app and executable notebooks.

All naive datetime indices represent fixed NEM market time, AEST (UTC+10).
"""
from __future__ import annotations
import json
from pathlib import Path
import numpy as np
import pandas as pd
from scipy.ndimage import gaussian_filter1d

ROOT = Path(__file__).resolve().parent
SEASONS = ['All seasons', 'Summer', 'Autumn', 'Winter', 'Spring']
BASELINES = {'Last interval': 'persistence', 'Previous day': 'previousDay', 'Previous week': 'previousWeek'}


def load_market(path: Path | None = None):
    payload = json.loads((path or ROOT / 'public/data/market.json').read_text())
    if payload.get('schemaVersion') != 1 or not payload.get('rows'):
        raise ValueError('The market artifact is missing or has an unsupported schema. Run scripts/build_data.py.')
    frame = pd.DataFrame(payload['rows'], columns=payload['columns'])
    frame['time'] = pd.to_datetime(frame['time'])
    frame = frame.set_index('time').astype(float)
    if not frame.index.is_unique or not frame.index.is_monotonic_increasing:
        raise ValueError('Market observations must have unique, increasing timestamps.')
    return frame, {key: value for key, value in payload.items() if key not in ['rows', 'columns']}


def season_labels(index: pd.DatetimeIndex) -> pd.Series:
    month = index.month
    return pd.Series(np.select([np.isin(month, [12, 1, 2]), np.isin(month, [3, 4, 5]), np.isin(month, [6, 7, 8])],
                               ['Summer', 'Autumn', 'Winter'], default='Spring'), index=index, name='season')


def filter_market(frame, start, end, season='All seasons'):
    if pd.Timestamp(start).date() > pd.Timestamp(end).date():
        return frame.iloc[:0].copy()
    selected = frame.loc[str(pd.Timestamp(start).date()):str(pd.Timestamp(end).date())]
    if season != 'All seasons':
        selected = selected.loc[season_labels(selected.index).eq(season)]
    return selected.copy()


def aggregate_market(frame, resolution='Auto'):
    if frame.empty:
        return frame.copy(), '30-minute'
    days = (frame.index.max() - frame.index.min()).total_seconds() / 86400
    selected = ('Daily' if days > 90 else 'Hourly' if days > 7 else '30 minutes') if resolution == 'Auto' else resolution
    if selected == '30 minutes':
        return frame.copy(), '30-minute'
    aggregation = {column: 'max' if column == 'maxPrice' else 'min' if column == 'minPrice' else 'mean' for column in frame.columns}
    return frame.resample('1D' if selected == 'Daily' else '1h').agg(aggregation), selected


def smooth_prices(frame, method='Trailing EMA', strength=6):
    # Missing intervals and seasonal discontinuities start a new independent segment.
    price = frame.price
    breaks = frame.index.to_series().diff().ne(pd.Timedelta('30min')) | price.isna() | price.shift().isna()
    result = pd.Series(np.nan, index=frame.index, name='smoothed')
    for _, segment in price.groupby(breaks.cumsum()):
        observed = segment.dropna()
        if observed.empty:
            continue
        if method == 'Trailing EMA':
            result.loc[observed.index] = observed.ewm(span=strength, adjust=False).mean()
        elif method == 'Centered Gaussian':
            # Truncate and renormalize at segment edges, matching a centered finite kernel.
            values = observed.to_numpy()
            weighted = gaussian_filter1d(values, sigma=strength, truncate=3, mode='constant', cval=0)
            weights = gaussian_filter1d(np.ones(len(values)), sigma=strength, truncate=3, mode='constant', cval=0)
            result.loc[observed.index] = weighted / weights
        else:
            raise ValueError(f'Unknown smoothing method: {method}')
    return result


def price_episodes(frame, threshold=300):
    columns = ['start', 'end', 'peak_time', 'peak_price', 'peak_dispatch', 'duration_minutes', 'demand', 'solar', 'temperature']
    records = []
    high = frame.price.ge(threshold) & frame.price.notna()
    gaps = frame.index.to_series().diff().ne(pd.Timedelta('30min'))
    groups = (high.ne(high.shift()) | gaps).cumsum()
    for _, subset in frame.loc[high].groupby(groups[high]):
        peak = subset.price.idxmax()
        records.append(dict(start=subset.index[0], end=subset.index[-1], peak_time=peak,
                            peak_price=subset.loc[peak, 'price'], peak_dispatch=subset.maxPrice.max(),
                            duration_minutes=len(subset) * 30, demand=subset.loc[peak, 'demand'],
                            solar=subset.loc[peak, 'solar'], temperature=subset.loc[peak, 'temperature']))
    return pd.DataFrame(records, columns=columns).sort_values('peak_price', ascending=False).reset_index(drop=True)


def score_forecasts(frame, column='prediction'):
    pairs = frame[['price', column]].dropna()
    errors = pairs[column] - pairs.price
    return {'count': len(pairs), 'mae': errors.abs().mean(), 'rmse': np.sqrt(errors.pow(2).mean()), 'bias': errors.mean()}


def export_csv(frame):
    exported = frame.copy()
    exported.index = exported.index.strftime('%Y-%m-%dT%H:%M')
    exported.index.name = 'time_AEST_UTC_plus_10'
    return exported.to_csv().encode('utf-8')
