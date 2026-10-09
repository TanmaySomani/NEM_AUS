"""Exercise the actual Streamlit script, including widget callbacks."""
from datetime import date
from pathlib import Path
import unittest

from streamlit.testing.v1 import AppTest

APP = Path(__file__).resolve().parents[1] / 'streamlit_app.py'


class DashboardTests(unittest.TestCase):
    def setUp(self):
        self.app = AppTest.from_file(str(APP), default_timeout=30).run()
        self.assertFalse(self.app.exception)

    def assert_healthy(self):
        self.assertEqual([item.message for item in self.app.exception], [])

    def test_all_views_and_smoothing_render(self):
        for view in ['Volatility lab', 'Forecasting', 'Data & methods', 'Market overview']:
            self.app.radio(key='view').set_value(view).run()
            self.assert_healthy()
            if view == 'Volatility lab':
                next(widget for widget in self.app.selectbox if widget.label == 'Smoothing method').set_value('Centered Gaussian').run()
                self.assert_healthy()
                self.assertTrue(any('future observations' in item.value for item in self.app.info))

    def test_empty_season_and_reset_callback(self):
        self.app.selectbox(key='season').set_value('Summer').run()
        self.assert_healthy()
        self.assertTrue(any('No observations' in item.value for item in self.app.info))
        next(button for button in self.app.button if button.label == 'Reset filters').click().run()
        self.assert_healthy()
        self.assertEqual(self.app.selectbox(key='season').value, 'All seasons')
        self.assertEqual(len(self.app.metric), 4)

    def test_test_period_callback_restores_forecasts(self):
        self.app.date_input(key='dates').set_value((date(2022, 1, 1), date(2022, 1, 31))).run()
        self.app.radio(key='view').set_value('Forecasting').run()
        self.assert_healthy()
        self.assertTrue(any('outside the test period' in item.value for item in self.app.warning))
        next(button for button in self.app.button if button.label == 'View the full 2024 test period').click().run()
        self.assert_healthy()
        self.assertEqual(self.app.date_input(key='dates').value[0], date(2024, 1, 1))
        paired = next(metric for metric in self.app.metric if metric.label == 'Paired test predictions')
        self.assertEqual(paired.value, '9,871')


if __name__ == '__main__':
    unittest.main()
