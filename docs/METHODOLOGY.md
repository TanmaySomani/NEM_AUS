# Data and evaluation contract

## Data sources and resolution

The canonical price source is `nsw_prices.csv` (269,452 five-minute regional reference price observations). Actual and recorded forecast demand are half-hour series. Rooftop solar contains alternative MEASUREMENT and SATELLITE estimates for almost every timestamp. `CCtemps.csv` contains hourly weather in UTC, with Sydney represented by column 66214. `nsw_merged_all.csv` is intentionally not used because it duplicates timestamps when joining solar types. `nsw_pricedat.csv` is an overlapping price extract with a different endpoint and additional columns; it is preserved but not combined with the canonical price source.

The common analysis grid runs from the first demand observation to the earlier of the last demand or canonical price observation. This produces 44,911 positions from 2022-01-01 00:00 to 2024-07-24 15:00.

## Interval and timezone rules

A label `t` represents an interval ending at `t`. Six prices from `(t - 30 minutes, t]` form the half-hour price. If fewer or more than six observations exist, the half-hour price and its dispatch extrema remain null. The initial bin is incomplete. This avoids treating a single five-minute price as a full half-hour average.

Electricity timestamps are timezone-naive in the supplied files. The pipeline assumes they use NEM market time: fixed AEST/UTC+10, without daylight saving. This follows [AEMO’s market-time convention](https://markets-portal-help.docs.public.aemo.com.au/Content/MarketsPortal/UsingMarketsPortal.htm), but does not prove that the original CSV export retained that convention. Weather explicitly labelled UTC is parsed day-first, converted to fixed UTC+10, and aligned by the most recent preceding observation within one hour. A missing recorded hourly value stays missing rather than being filled from a future value.

Browser display and date arithmetic use explicit AEST or UTC arithmetic, independent of the viewer’s operating-system timezone.

## Solar and missing values

Select the MEASUREMENT rooftop-solar value when available. Use SATELLITE only when that measurement is absent. These are alternatives, not separate generation sources. Do not add rooftop solar to operational grid demand to claim an official total generation or renewable share.

All channels join onto a regular half-hour grid. No price interpolation, backward fill, global-mean imputation, outlier clipping or replacement of missing values with zero occurs. The tree regressor handles missing lagged weather/demand/solar features natively. The classifier median-imputes those lagged features using only its fitted training data. Rows without complete required price lags or targets are excluded from evaluation.

Source SHA-256 checksums, input row counts, output coverage, duplicate counts and missing values are included in `public/data/market.json`.

## Aggregation and events

Metrics, exports, classification and event detection use original half-hours. Chart resolution controls only presentation. Auto resolution uses half-hours for up to seven days, hourly averages through 90 days and daily averages for longer ranges. Means use available values; incomplete buckets are not presented as complete coverage. Dispatch minimum and maximum survive aggregation as extrema, not means.

A high-price interval has a half-hour mean greater than or equal to the selected analytical threshold. An episode joins only contiguous high-price half-hours. Missing positions, low-price observations and seasonal gaps break episodes. An episode’s conditions describe its highest-price half-hour; its dispatch peak is the maximum five-minute price within the whole episode. Dates in the episode list denote interval endings. Episode duration is interval count multiplied by 30 minutes, so the episode’s physical start precedes its first displayed interval ending by 30 minutes.

Negative-price share counts half-hour means below zero. The median and percentiles are calculated across valid half-hour means. Five-minute spikes can exist within half-hours whose average is below the spike threshold. Selecting “5-min peaks” exposes the five-minute maximum for each displayed chart bucket.

## Smoothing

EMA uses alpha `2 / (span + 1)` and only current and preceding prices. Gaussian smoothing has a symmetric kernel truncated at three sigma; it uses both past and future values and is explicitly retrospective. Both restart at missing values or discontinuous timestamps. Smoothing runs on half-hours before chart aggregation, and never changes events, targets or evaluation metrics.

## Model task

The regression target is the next observed half-hour average. A prediction for interval ending `t` can use the observed half-hour ending `t - 30 minutes`, plus earlier lags, trailing statistics and the known calendar at `t`. This is a nominal one-interval horizon, ignoring real source publication latency. It is not a day-ahead forecast. Demand, solar and temperature are each lagged by one interval. Recorded demand forecasts are excluded from predictive features because their issue times are absent. No same-interval realized demand, solar or price enters the predictors.

Features:

- Prices lagged 1, 2, 48 and 336 half-hours.
- Trailing mean price over 6 and 48 half-hours, shifted before rolling.
- Demand, solar and temperature lagged by one half-hour.
- Sine/cosine cycles for hour, weekday and month.

The regular time grid is retained before creating lags. The first week acts as lookback context. Null required price lags and full-window trailing means are not imputed.

## Chronological experiment

1. Fit candidates on eligible observations before 2023-07-01.
2. Compare gradient boosting with absolute-error versus squared-error loss on 2023-07-01–2023-12-31. Choose lower validation MAE. Automatic/random validation and early stopping are disabled.
3. For the random forest classifier, choose the score cutoff maximizing validation F1 for the fixed half-hour price ≥ $300/MWh label. Its class weights address training imbalance, and its scores are explicitly not calibrated probabilities.
4. Refit the selected regressor and classifier on train plus validation. Keep them fixed for the test.
5. Score eligible observations from 2024-01-01 onward. As each test observation becomes history, it can supply a lag to a later prediction. This is a rolling one-step evaluation, with no model retraining during test.

The test is never used for choosing the regression loss, classifier cutoff or preprocessing statistics. There is no season-specific reordering or shuffled split. Fixed seed 42 and pinned Python libraries support reproducibility.

## Metrics and uncertainty

Regression reports MAE, RMSE and signed prediction bias in AUD/MWh on the same eligible test rows for all four models. Filtered charts recompute MAE and RMSE on the original paired half-hours rather than on averaged chart points.

Classification reports precision, recall, F1, average precision, class prevalence and a confusion matrix. An always-negative classifier would have superficially high accuracy, which is why raw accuracy is not the headline measure. The confusion matrix ordering is scikit-learn’s `[[TN, FP], [FN, TP]]`.

The optional error reference uses the 80th percentile of absolute validation errors from the training-only regressor. The final regressor is refit afterward. The reference is constant width, not a conditional or calibrated interval. Its achieved full-test coverage is displayed. It must not be interpreted as a guaranteed 80% future interval.

Feature importance measures the increase in validation MAE when a feature is permuted, using three repeats and up to 2,000 validation observations. It is computed before refitting and is independent of the test. It describes model dependence, not a causal effect. Correlated lags can share importance.

## Scientific limits and next work

This rebuild establishes an honest benchmark instead of reproducing an unverified notebook score. Persistence outperformed gradient boosting on the new 2024 test. Outliers are retained, so RMSE is much larger than MAE. A historical point-in-time replay with source publication times is necessary before claiming an operational forecast.

A later research phase could add rolling-origin folds across more years, forecast issue times, multiple regions with actual source files, generator outages, bidding and interconnector data, and explicit economic loss functions. A revised model would require a fresh untouched holdout; this observed 2024 result must not become a repeatedly tuned “test” score. LSTMs should be introduced only with a causal feature design and a demonstrated improvement over the baselines.

Reference: [scikit-learn gradient boosting](https://scikit-learn.org/stable/modules/generated/sklearn.ensemble.HistGradientBoostingRegressor.html), [AEMO data](https://www.aemo.com.au/energy-systems/electricity/national-electricity-market-nem/data-nem).
