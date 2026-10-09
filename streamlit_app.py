"""NEM Observatory: the Streamlit Community Cloud entry point."""
from __future__ import annotations
from datetime import timedelta, date
import json
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st
from nem_analysis import (load_market, filter_market, aggregate_market, smooth_prices,
                          price_episodes, score_forecasts, export_csv, SEASONS, BASELINES)

st.set_page_config(page_title='NEM Observatory · NSW electricity', page_icon='⚡', layout='wide')
TEAL, INK, ORANGE, BLUE = '#087e72', '#233c35', '#df9562', '#8296b0'
VIEWS = ['Market overview', 'Volatility lab', 'Forecasting', 'Data & methods']

@st.cache_data(show_spinner=False)
def data():
    return load_market()

def number(value, digits=0):
    return '—' if pd.isna(value) else f'{value:,.{digits}f}'

def money(value):
    return '—' if pd.isna(value) else f'{"−" if value < 0 else ""}${abs(value):,.2f}'

def chart(figure, key):
    figure.update_layout(template='plotly_white', paper_bgcolor='rgba(0,0,0,0)', plot_bgcolor='rgba(0,0,0,0)',
                         font=dict(family='sans-serif', color=INK, size=12), margin=dict(l=20, r=20, t=25, b=20),
                         legend=dict(orientation='h', y=1.12, x=0), hovermode=figure.layout.hovermode or 'x unified')
    figure.update_xaxes(showgrid=False)
    figure.update_yaxes(gridcolor='#e5ece5', zerolinecolor='#d5e0d5')
    st.plotly_chart(figure, width='stretch', key=key, config={'displaylogo': False})

def lines(frame, columns, ylabel, height=350, slider=True):
    figure = go.Figure()
    for column, name, color, dash in columns:
        figure.add_trace(go.Scatter(x=frame.index, y=frame[column], name=name, mode='lines',
                                   connectgaps=False, line=dict(color=color, width=1.7, dash=dash)))
    figure.update_layout(height=height, yaxis_title=ylabel, xaxis_title='Interval ending · AEST (UTC+10)')
    if slider:
        figure.update_xaxes(rangeslider_visible=True, rangeslider_thickness=.07)
    return figure

def show_events(frame, threshold):
    events = price_episodes(frame, threshold)
    st.subheader('High-price episodes')
    st.caption(f'Contiguous half-hours ≥ ${threshold:,}/MWh · ranked by peak average. Dates label interval endings.')
    if events.empty:
        st.success('No high-price episodes in this selection. Try a lower threshold or a wider date range.')
        return
    display = events.rename(columns={'start': 'First interval ending · AEST', 'end': 'Last interval ending · AEST',
                                      'peak_time': 'Peak interval · AEST', 'peak_price': 'Peak average · $/MWh',
                                      'peak_dispatch': 'Peak dispatch · $/MWh', 'duration_minutes': 'Duration · min',
                                      'demand': 'Demand at peak · MW', 'solar': 'Solar at peak · MW', 'temperature': 'Sydney at peak · °C'})
    selected = st.dataframe(display, hide_index=True, width='stretch', on_select='rerun', selection_mode='single-row', key='episodes')
    if selected.selection.rows and selected.selection.rows[0] < len(events):
        item = events.iloc[selected.selection.rows[0]]
        with st.container(border=True):
            st.markdown(f'**Episode detail · {item.start:%d %b %Y %H:%M} AEST**')
            a, b, c, d = st.columns(4)
            a.metric('Peak half-hour average', money(item.peak_price), help='AUD/MWh')
            b.metric('Peak five-minute price', money(item.peak_dispatch), help='AUD/MWh')
            c.metric('Duration', f'{number(item.duration_minutes)} min')
            d.metric('Sydney temperature at peak', f'{number(item.temperature, 1)} °C')
            st.caption('Demand, solar and temperature describe the highest-price half-hour. Episode duration includes the half-hour preceding its first interval-ending label.')
            context = frame.loc[item.start.normalize():item.end.normalize() + pd.Timedelta(days=1) - pd.Timedelta(minutes=30)]
            chart(lines(context, [('price','Spot price', TEAL, 'solid')], 'AUD/MWh', 260, False), 'event-context')

try:
    frame, metadata = data()
except (OSError, ValueError, KeyError) as exc:
    st.error(f'The market artifact could not be loaded: {exc}')
    st.stop()

quality, benchmark = metadata['quality'], metadata['benchmark']
first, last = frame.index.min().date(), frame.index.max().date()
query = st.query_params

def query_date(key, default):
    try:
        value = date.fromisoformat(query.get(key, str(default)))
        return value if first <= value <= last else default
    except ValueError:
        return default

if 'dates' not in st.session_state:
    st.session_state.dates = (query_date('from', last - timedelta(days=29)), query_date('to', last))
if 'view' not in st.session_state:
    st.session_state.view = query.get('view') if query.get('view') in VIEWS else VIEWS[0]
if 'season' not in st.session_state:
    st.session_state.season = query.get('season') if query.get('season') in SEASONS else SEASONS[0]
if 'threshold' not in st.session_state:
    st.session_state.threshold = int(query.get('threshold', '300')) if query.get('threshold', '300') in ['100','300','1000','5000'] else 300
if 'resolution' not in st.session_state:
    st.session_state.resolution = query.get('resolution') if query.get('resolution') in ['Auto','30 minutes','Hourly','Daily'] else 'Auto'

def preset(days):
    st.session_state.dates = (first if days is None else last - timedelta(days=days-1), last)

def full_test():
    st.session_state.dates = (date(2024, 1, 1), last)
    st.session_state.season = 'All seasons'

def reset():
    preset(30)
    st.session_state.season = SEASONS[0]
    st.session_state.threshold = 300
    st.session_state.resolution = 'Auto'

with st.sidebar:
    st.markdown('### NEM Observatory')
    st.caption('NSW1 · historical research data')
    st.date_input('Date range · AEST', min_value=first, max_value=last, format='DD/MM/YYYY', key='dates')
    a,b,c,d = st.columns(4)
    for column, label, days in [(a,'7D',7),(b,'30D',30),(c,'90D',90),(d,'All',None)]:
        column.button(label, on_click=preset, args=(days,), width='stretch')
    st.selectbox('Australian season', SEASONS, key='season')
    st.selectbox('Chart resolution', ['Auto','30 minutes','Hourly','Daily'], key='resolution')
    st.selectbox('Exploratory spike threshold · AUD/MWh', [100,300,1000,5000], key='threshold')
    st.button('Reset filters', on_click=reset, width='stretch')
    st.divider()
    st.caption('Coverage: 1 Jan 2022–24 Jul 2024. This is a historical NSW dataset, not a live market feed.')
    st.link_button('Source repository', 'https://github.com/TanmaySomani/NEM_AUS', width='stretch')

st.caption('AUSTRALIAN ENERGY INTELLIGENCE · NEW SOUTH WALES')
st.title('NEM Observatory')
st.markdown('A clearer view of electricity prices, demand and rooftop solar — with the evidence behind every forecast.')
view = st.radio('Dashboard view', VIEWS, horizontal=True, key='view', label_visibility='collapsed')
dates = st.session_state.dates
if len(dates) != 2:
    st.info('Select both a start date and an end date to explore the market.')
    st.stop()
start, end = dates
season, threshold, resolution = st.session_state.season, st.session_state.threshold, st.session_state.resolution
selected = filter_market(frame, start, end, season)
query.from_dict({'from':str(start), 'to':str(end), 'view':view, 'season':season, 'threshold':str(threshold), 'resolution':resolution})
export = frame if view == 'Data & methods' else selected
left, right = st.columns([3,1])
left.caption(f'{start:%d %b %Y} – {end:%d %b %Y} · {len(selected):,} half-hour positions · AEST (UTC+10). Copy the browser URL to share these filters.')
right.download_button('Export all data' if view == 'Data & methods' else 'Export selected CSV', export_csv(export), file_name='nem-nsw.csv', mime='text/csv', disabled=export.empty, width='stretch')
if view != 'Data & methods' and (selected.empty or selected.price.dropna().empty):
    st.info('No observations in this selection. Choose another season or date range.')
    st.stop()
sampled, label = aggregate_market(selected, resolution)
price = selected.price.dropna()

if view == 'Market overview':
    a,b,c,d = st.columns(4)
    a.metric('Average spot price · $/MWh', money(price.mean()), help=f'Median {money(price.median())}. Calculated across valid half-hours.')
    b.metric('Average operational demand', f'{number(selected.demand.mean()/1000,2)} GW')
    c.metric('Average rooftop solar', f'{number(selected.solar.mean()/1000,2)} GW')
    d.metric('High-price intervals', f'{price.ge(threshold).sum():,}', help=f'Half-hour mean ≥ ${threshold:,}/MWh')
    left,right = st.columns([2,1])
    with left:
        st.subheader('Spot price over time')
        st.caption(f'{label} averages · use the range slider to zoom')
        peak = st.checkbox('Show five-minute peaks')
        columns = [('price','Spot price',TEAL,'solid')] + ([('maxPrice','Peak 5-minute price',ORANGE,'dot')] if peak else [])
        fig = lines(sampled, columns, 'AUD/MWh')
        fig.add_hline(y=threshold, line_dash='dash', line_color=ORANGE, annotation_text=f'${threshold:,} threshold')
        chart(fig,'price')
    with right:
        st.subheader('The daily rhythm')
        profile = selected.groupby(selected.index.hour).price.mean()
        fig = go.Figure(go.Bar(x=profile.index, y=profile.values, marker_color=[TEAL if x==profile.idxmax() else '#bad7c9' for x in profile.index]))
        fig.update_layout(height=350, xaxis_title='Hour of day · AEST', yaxis_title='Mean AUD/MWh')
        chart(fig,'profile')
        st.caption(f'{profile.idxmax():02d}:00 has the highest mean price in this selection: {money(profile.max())}/MWh.')
    st.subheader('Demand meets rooftop solar')
    chart(lines(sampled,[('demand','Operational demand',INK,'solid'),('forecastDemand','Recorded POE50 forecast',BLUE,'dash'),('solar','Rooftop solar',ORANGE,'solid')],'MW'), 'demand')
    st.caption('Rooftop solar is behind-the-meter generation, not the complete generation mix. Recorded demand forecasts have no issue-time metadata and do not enter the predictive model.')
    with st.expander('Price distribution and coverage'):
        st.dataframe(pd.DataFrame({'Statistic':['Minimum','Median','95th percentile','Maximum','Negative-price share','Valid observations'], 'Value':[money(price.min()),money(price.median()),money(price.quantile(.95)),money(price.max()),f'{price.lt(0).mean():.1%}',f'{len(price):,} / {len(selected):,}']}), hide_index=True, width='stretch')
    show_events(selected,threshold)

elif view == 'Volatility lab':
    st.subheader('Smoothing workbench')
    a,b=st.columns(2)
    method=a.selectbox('Smoothing method',['Trailing EMA','Centered Gaussian'])
    strength=b.slider('Span / sigma · half-hour intervals',2,12,6)
    smoothed=selected.assign(smoothed=smooth_prices(selected,method,strength))
    smooth_sample,_=aggregate_market(smoothed,resolution)
    chart(lines(smooth_sample,[('price','Observed price',BLUE,'solid'),('smoothed',method,TEAL,'solid')],'AUD/MWh'),'smoothing')
    st.info(('Centered Gaussian uses future observations and is retrospective only. ' if method=='Centered Gaussian' else 'EMA uses the current and preceding observations. ')+'Smoothing changes the visual trend, never the recorded prices, spike counts or model targets.')
    left,right=st.columns(2)
    with left:
        st.subheader('When prices run high')
        heat=selected.assign(weekday=selected.index.dayofweek,hour=selected.index.hour).pivot_table(index='weekday',columns='hour',values='price',aggfunc='mean').reindex(index=range(7),columns=range(24))
        fig=px.imshow(heat.to_numpy(),x=list(range(24)),y=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],aspect='auto',color_continuous_scale=['#edf4ee','#96c8b3',TEAL,'#16463f'],labels=dict(x='Hour · AEST',y='Weekday',color='AUD/MWh'))
        fig.update_layout(height=330,hovermode='closest');chart(fig,'heatmap')
    with right:
        st.subheader('Sydney weather and price')
        scatter=selected[['temperature','price']].dropna().iloc[::max(1,len(selected)//1800)]
        fig=px.scatter(scatter,x='temperature',y='price',color_discrete_sequence=[TEAL],opacity=.4,labels={'temperature':'Sydney temperature · °C','price':'AUD/MWh'})
        fig.update_layout(height=330,hovermode='closest');chart(fig,'weather')
        st.caption(f'{len(scatter):,} regularly sampled points. Association does not establish cause; missing temperatures are excluded.')
    show_events(selected,threshold)

elif view == 'Forecasting':
    st.info(f'The last-interval baseline wins on the full test period: MAE {benchmark["models"][1]["mae"]:.2f} AUD/MWh versus {benchmark["models"][0]["mae"]:.2f} for gradient boosting. These are rolling one-step backtests, not multi-step future forecasts.')
    tested=selected.dropna(subset=['prediction'])
    if tested.empty:
        st.warning('This selection falls outside the test period. Predictions begin on 1 January 2024.')
        st.button('View the full 2024 test period', on_click=full_test)
    else:
        baseline=st.selectbox('Comparison baseline',list(BASELINES))
        score=score_forecasts(tested);base=score_forecasts(tested,BASELINES[baseline])
        a,b,c,d=st.columns(4)
        a.metric('Model MAE · $/MWh',money(score['mae']));b.metric('Baseline MAE · $/MWh',money(base['mae']))
        c.metric('Model RMSE · $/MWh',money(score['rmse']));d.metric('Paired test predictions',f'{score["count"]:,}')
        sampled_test,test_label=aggregate_market(tested,resolution)
        fig=lines(sampled_test,[('price','Observed price',INK,'solid'),('prediction','Gradient boosting',TEAL,'solid'),(BASELINES[baseline],baseline,ORANGE,'dash')],'AUD/MWh')
        if st.checkbox('Show validation error reference'):
            for direction,name in [(1,'Upper error reference'),(-1,'Lower error reference')]:
                fig.add_trace(go.Scatter(x=sampled_test.index,y=sampled_test.prediction+direction*benchmark['bandWidth'],name=name,mode='lines',line=dict(color='#b2cfc4',dash='dot',width=1)))
        chart(fig,'forecast')
        st.caption(f'{test_label} chart averages; metrics use original half-hours. Error reference ±{money(benchmark["bandWidth"])} is the 80th percentile of absolute validation errors, not a calibrated interval. Full-test coverage: {benchmark["bandTestCoverage"]:.1f}%.')
    left,right=st.columns(2)
    with left:
        st.subheader('Full-test leaderboard')
        st.caption('1 Jan–24 Jul 2024 · 9,871 eligible half-hours · lower error is better')
        leaderboard=pd.DataFrame(benchmark['models']).sort_values('mae').rename(columns={'name':'Model','mae':'MAE · $/MWh','rmse':'RMSE · $/MWh','bias':'Bias · $/MWh'})
        st.dataframe(leaderboard,hide_index=True,width='stretch')
    with right:
        st.subheader('What the model uses')
        importance=pd.DataFrame(benchmark['importance']).head(7).sort_values('importance')
        fig=px.bar(importance,x='importance',y='feature',orientation='h',color_discrete_sequence=[TEAL],labels={'importance':'Validation MAE increase · $/MWh','feature':''})
        fig.update_layout(height=270);chart(fig,'importance')
        st.caption('Validation permutation importance; model dependence, not causation.')
    st.subheader('Detecting high-price intervals')
    classifier=benchmark['classifier'];a,b,c,d=st.columns(4)
    for col,key,title in [(a,'precision','Precision'),(b,'recall','Recall'),(c,'f1','F1'),(d,'averagePrecision','Average precision')]:
        col.metric(title,f'{classifier[key]:.1%}')
    st.caption(f'Full-test metrics · fixed target: next half-hour price ≥ $300/MWh · prevalence {classifier["prevalence"]:.1%} · validation-selected cutoff {classifier["probabilityCutoff"]:.3f}. The exploratory threshold does not retrain this model. Scores are not calibrated probabilities.')
    st.dataframe(pd.DataFrame(classifier['confusion'],index=['Actual below $300','Actual ≥ $300'],columns=['Predicted below $300','Predicted ≥ $300']),width='stretch')
    if not tested.empty:
        risk=lines(sampled_test,[('risk','Spike score',TEAL,'solid')],'Score · 0–1',250,False)
        risk.update_yaxes(range=[0,1]);risk.add_hline(y=classifier['probabilityCutoff'],line_dash='dash',line_color=ORANGE)
        chart(risk,'risk');st.caption('Scores are averaged at the selected chart resolution; the classifier decision uses original half-hours.')

else:
    st.subheader('One dataset. A traceable process.')
    a,b,c=st.columns(3)
    a.metric('Half-hour positions',f'{quality["expectedIntervals"]:,}');b.metric('Complete price coverage',f'{quality["completePrices"]/quality["expectedIntervals"]:.2%}');c.metric('Solar alternatives resolved',f'{quality["solarAlternativesResolved"]:,}')
    st.dataframe(pd.DataFrame(quality['sources']),hide_index=True,width='stretch')
    st.subheader('Missing observations before filtering')
    st.dataframe(pd.DataFrame(quality['missing'].items(),columns=['Channel','Missing positions']),hide_index=True,width='stretch')
    st.markdown('''#### Cleaning and evaluation decisions
- Average six five-minute dispatch prices in each interval `(t − 30 min, t]`. Incomplete bins stay missing.
- Choose solar MEASUREMENT, with SATELLITE fallback only when absent. Never sum the alternatives.
- Convert explicitly UTC weather to fixed AEST. Carry previous weather for at most one hour; preserve missing values.
- Preserve negative prices and extremes. No price clipping, target imputation or backward filling.
- Train before July 2023; validate July–December 2023; refit and freeze before the 2024 test.
- Predict from lagged prices, demand, solar and weather plus known calendar cycles. Same-interval actuals never enter features.
- Recorded demand forecasts have no issue times and are excluded from the model.

#### Limits
NSW historical data only. Electricity CSV timestamps are assumed to be AEST, without daylight saving. Missing publication times prevent an operational point-in-time replay. Smoothing is descriptive and does not stabilise market prices. No causal or trading-performance claim is made.
''')
    st.link_button('Read the full methodology','https://github.com/TanmaySomani/NEM_AUS/blob/main/docs/METHODOLOGY.md')
    st.download_button('Download the benchmark audit',json.dumps(benchmark,indent=2),file_name='nem-benchmark.json',mime='application/json')

st.divider()
st.caption('NEM Observatory · Tanmay Somani · Historical NSW observations · AUD · AEST (UTC+10)')
