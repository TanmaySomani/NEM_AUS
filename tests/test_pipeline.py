import unittest
import sys
from pathlib import Path
import numpy as np
import pandas as pd
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from build_data import prepare_data, make_features

class PipelineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.df, cls.audit = prepare_data()

    def test_solar_is_one_observation_per_interval(self):
        self.assertTrue(self.df.index.is_unique)
        source = pd.read_csv(Path(__file__).resolve().parents[1] / 'nsw_solar.csv')
        row = source[(source.INTERVAL_DATETIME == '2022-01-01 12:00:00') & (source.TYPE == 'MEASUREMENT')].iloc[0]
        self.assertEqual(self.df.loc['2022-01-01 12:00', 'solar'], row.POWER)

    def test_price_bin_uses_six_preceding_dispatch_observations(self):
        source = pd.read_csv(Path(__file__).resolve().parents[1] / 'nsw_prices.csv')
        source['date_time'] = pd.to_datetime(source.date_time)
        rows = source[(source.date_time > '2022-01-01 00:00') & (source.date_time <= '2022-01-01 00:30')]
        self.assertEqual(len(rows), 6)
        self.assertAlmostEqual(self.df.loc['2022-01-01 00:30', 'price'], rows.RRP.mean())
        self.assertTrue(pd.isna(self.df.iloc[0].price))

    def test_weather_is_converted_from_utc(self):
        self.assertAlmostEqual(self.df.loc['2022-01-01 01:00', 'temperature'], 21.7)

    def test_no_future_information_in_features(self):
        before = make_features(self.df)
        future = self.df.copy()
        origin = pd.Timestamp('2023-06-01 12:00')
        future.loc[origin:, ['price', 'demand', 'solar', 'temperature']] = 999999
        after = make_features(future)
        pd.testing.assert_frame_equal(before.loc[:origin], after.loc[:origin])

    def test_regular_grid_and_nulls_are_preserved(self):
        self.assertTrue((self.df.index.to_series().diff().dropna() == pd.Timedelta('30min')).all())
        self.assertGreater(self.audit['solarAlternativesResolved'], 44000)
        self.assertGreater(self.audit['missing']['temperature'], 0)


class ArtifactTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import json
        cls.payload = json.loads((Path(__file__).resolve().parents[1] / 'public/data/market.json').read_text())
        cls.frame = pd.DataFrame(cls.payload['rows'], columns=cls.payload['columns'])

    def test_predictions_exist_only_on_held_out_test_rows(self):
        predicted = self.frame[self.frame.prediction.notna()]
        self.assertEqual(len(predicted), self.payload['benchmark']['test']['count'])
        self.assertTrue((predicted.time >= '2024-01-01T00:00').all())
        self.assertTrue(self.frame.loc[self.frame.time < '2024-01-01T00:00', 'risk'].isna().all())
        self.assertLess(self.payload['benchmark']['train']['end'], self.payload['benchmark']['validation']['start'])
        self.assertLess(self.payload['benchmark']['validation']['end'], self.payload['benchmark']['test']['start'])

    def test_published_metrics_match_exported_observations(self):
        predicted = self.frame[self.frame.prediction.notna()]
        for key, name in [('prediction', 'Gradient boosting'), ('persistence', 'Last interval'), ('previousDay', 'Previous day'), ('previousWeek', 'Previous week')]:
            expected = next(m for m in self.payload['benchmark']['models'] if m['name'] == name)
            actual = float(np.abs(predicted[key] - predicted.price).mean())
            self.assertAlmostEqual(actual, expected['mae'], delta=.002)

if __name__ == '__main__':
    unittest.main()
