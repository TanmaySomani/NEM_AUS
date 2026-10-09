"""Market semantics shared by the notebooks and Streamlit dashboard."""
import io
import unittest

import numpy as np
import pandas as pd

from nem_analysis import (
    aggregate_market, export_csv, filter_market, price_episodes,
    score_forecasts, season_labels, smooth_prices,
)


class AnalysisTests(unittest.TestCase):
    def setUp(self):
        self.frame = pd.DataFrame(
            {'price': [-20, 300, 400, np.nan, 500, 50],
             'maxPrice': [10, 600, 800, np.nan, 900, 100],
             'minPrice': [-50, 100, 200, np.nan, 300, 0],
             'demand': [1, 2, 3, 4, 5, 6],
             'solar': [0, 1, 2, 3, 4, 5],
             'temperature': [20, 21, 22, 23, 24, 25]},
            index=pd.date_range('2024-01-01', periods=6, freq='30min', name='time'),
        )

    def test_dates_are_inclusive_and_seasons_are_australian(self):
        self.assertEqual(len(filter_market(self.frame, '2024-01-01', '2024-01-01')), 6)
        self.assertTrue(filter_market(self.frame, '2024-01-02', '2024-01-01').empty)
        self.assertTrue(filter_market(self.frame, '2024-01-01', '2024-01-01', 'Winter').empty)
        months = pd.date_range('2024-01-01', periods=12, freq='MS')
        self.assertEqual(season_labels(months).tolist(), [
            'Summer', 'Summer', 'Autumn', 'Autumn', 'Autumn', 'Winter',
            'Winter', 'Winter', 'Spring', 'Spring', 'Spring', 'Summer',
        ])

    def test_aggregation_preserves_extremes_and_negative_prices(self):
        daily, label = aggregate_market(self.frame, 'Daily')
        self.assertEqual(label, 'Daily')
        self.assertEqual(daily.iloc[0].maxPrice, 900)
        self.assertEqual(daily.iloc[0].minPrice, -50)
        self.assertEqual(daily.iloc[0].price, 246)

    def test_episodes_include_threshold_but_break_at_missing_intervals(self):
        episodes = price_episodes(self.frame, 300)
        self.assertEqual(episodes.duration_minutes.tolist(), [30, 60])
        self.assertEqual(episodes.peak_dispatch.tolist(), [900, 800])
        self.assertEqual(episodes.iloc[1].demand, 3)
        gapped = self.frame.drop(self.frame.index[2])
        self.assertEqual(len(price_episodes(gapped, 300)), 2)

    def test_ema_is_causal_and_missing_values_reset_smoothing(self):
        original = smooth_prices(self.frame)
        altered = self.frame.copy()
        altered.loc[altered.index[2]:, 'price'] = 9999
        pd.testing.assert_series_equal(original.iloc[:2], smooth_prices(altered).iloc[:2])
        self.assertTrue(np.isnan(original.iloc[3]))
        self.assertEqual(original.iloc[4], 500)
        centered = smooth_prices(self.frame, 'Centered Gaussian')
        self.assertTrue(np.isnan(centered.iloc[3]))
        self.assertGreater(centered.iloc[0], self.frame.price.iloc[0])

    def test_forecast_metrics_pair_only_available_observations(self):
        frame = self.frame.assign(prediction=[-10, np.nan, 380, 20, 530, 50])
        score = score_forecasts(frame)
        self.assertEqual(score['count'], 4)
        self.assertEqual(score['mae'], 15)
        self.assertEqual(score['bias'], 5)

    def test_export_has_explicit_timezone_and_preserves_missing_values(self):
        exported = pd.read_csv(io.BytesIO(export_csv(self.frame)))
        self.assertEqual(exported.columns[0], 'time_AEST_UTC_plus_10')
        self.assertEqual(exported.iloc[0, 0], '2024-01-01T00:00')
        self.assertTrue(np.isnan(exported.iloc[3].price))


if __name__ == '__main__':
    unittest.main()
