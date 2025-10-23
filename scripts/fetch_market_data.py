#!/usr/bin/env python3
"""Fetch Korean equity and ETF data for the dashboard."""

from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Dict, Iterable, List, Tuple
from zoneinfo import ZoneInfo

import pandas as pd
import requests
import yfinance as yf

DATA_DIR = Path('data')
HISTORY_DIR = DATA_DIR / 'history'
SNAPSHOT_FILE = DATA_DIR / 'latest.json'

SEOUL_TZ = ZoneInfo('Asia/Seoul')
UTC_TZ = ZoneInfo('UTC')

TICKERS: Dict[str, Dict[str, str]] = {
    '005930.KS': {
        'name': '삼성전자',
        'market': 'KRX',
    },
    '000660.KS': {
        'name': 'SK하이닉스',
        'market': 'KRX',
    },
    '360750.KS': {
        'name': 'TIGER S&P500',
        'market': 'KRX',
    },
    '133690.KS': {
        'name': 'TIGER 나스닥100',
        'market': 'KRX',
    },
}

RSI_PERIOD = 14
STOCH_K_PERIOD = 14
STOCH_D_PERIOD = 3
STOCH_SMOOTH = 3
MACD_FAST = 12
MACD_SLOW = 26
MACD_SIGNAL = 9
PRICE_CHART_DAYS = 60

BUY_THRESHOLD = 80
SELL_THRESHOLD = 20
INITIAL_CAPITAL = 10_000_000

PORTFOLIO_FILE = DATA_DIR / 'portfolio.json'

logging.basicConfig(level=logging.INFO, format='[%(levelname)s] %(message)s')

HISTORY_DIR.mkdir(parents=True, exist_ok=True)


def compute_rsi(series: pd.Series, period: int = RSI_PERIOD) -> float | None:
    if series.size < period + 1:
        return None

    delta = series.diff()
    gains = delta.clip(lower=0)
    losses = -delta.clip(upper=0)
    avg_gain = gains.ewm(alpha=1 / period, adjust=False).mean()
    avg_loss = losses.ewm(alpha=1 / period, adjust=False).mean()
    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))
    value = rsi.iloc[-1]
    return None if pd.isna(value) else float(value)


def compute_stochastic(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    k_period: int = STOCH_K_PERIOD,
    d_period: int = STOCH_D_PERIOD,
    smooth: int = STOCH_SMOOTH,
) -> Tuple[float | None, float | None]:
    if min(high.size, low.size, close.size) < k_period:
        return None, None

    highest_high = high.rolling(window=k_period).max()
    lowest_low = low.rolling(window=k_period).min()
    denominator = (highest_high - lowest_low).replace(0, pd.NA)
    raw_k = ((close - lowest_low) / denominator) * 100
    smoothed_k = raw_k.rolling(window=smooth).mean()
    smoothed_d = smoothed_k.rolling(window=d_period).mean()

    k_value = smoothed_k.iloc[-1]
    d_value = smoothed_d.iloc[-1]
    if pd.isna(k_value) or pd.isna(d_value):
        return None, None
    return float(k_value), float(d_value)


def compute_macd(
    close: pd.Series,
    fast: int = MACD_FAST,
    slow: int = MACD_SLOW,
    signal_period: int = MACD_SIGNAL,
) -> Tuple[float | None, float | None, float | None]:
    if close.size < slow:
        return None, None, None

    ema_fast = close.ewm(span=fast, adjust=False).mean()
    ema_slow = close.ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal_period, adjust=False).mean()
    histogram = macd_line - signal_line

    macd_value = macd_line.iloc[-1]
    signal_value = signal_line.iloc[-1]
    hist_value = histogram.iloc[-1]

    if pd.isna(macd_value) or pd.isna(signal_value) or pd.isna(hist_value):
        return None, None, None

    return float(macd_value), float(signal_value), float(hist_value)


def compute_indicators(history: pd.DataFrame) -> Dict[str, object]:
    close = history['Close']
    indicators: Dict[str, object] = {
        'sma5': float(close.tail(5).mean()) if close.size >= 5 else None,
        'sma20': float(close.tail(20).mean()) if close.size >= 20 else None,
        'rsi14': compute_rsi(close),
    }

    k_value, d_value = compute_stochastic(history['High'], history['Low'], close)
    indicators['stochastic'] = (
        {
            'k': k_value,
            'd': d_value,
            'k_period': STOCH_K_PERIOD,
            'd_period': STOCH_D_PERIOD,
            'smooth': STOCH_SMOOTH,
        }
        if k_value is not None and d_value is not None
        else None
    )

    macd_line, signal_line, histogram = compute_macd(close)
    indicators['macd'] = (
        {
            'macd': macd_line,
            'signal': signal_line,
            'histogram': histogram,
            'fast': MACD_FAST,
            'slow': MACD_SLOW,
            'signal_period': MACD_SIGNAL,
        }
        if macd_line is not None and signal_line is not None and histogram is not None
        else None
    )

    return indicators


def build_signals(indicators: Dict[str, float | None]) -> Dict[str, str]:
    signals: Dict[str, str] = {}

    sma5 = indicators.get('sma5')
    sma20 = indicators.get('sma20')
    if sma5 is not None and sma20 is not None:
        if sma5 > sma20:
            signals['trend'] = 'bullish'
        elif sma5 < sma20:
            signals['trend'] = 'bearish'
        else:
            signals['trend'] = 'neutral'
    else:
        signals['trend'] = 'neutral'

    rsi14 = indicators.get('rsi14')
    if rsi14 is not None:
        if rsi14 >= 70:
            signals['rsi'] = 'sell'
        elif rsi14 <= 30:
            signals['rsi'] = 'buy'
        else:
            signals['rsi'] = 'hold'
    else:
        signals['rsi'] = 'hold'

    stochastic = indicators.get('stochastic')
    if isinstance(stochastic, dict):
        k_value = stochastic.get('k')
        d_value = stochastic.get('d')
        if k_value is not None:
            if k_value >= 80:
                signals['stochastic'] = 'sell'
            elif k_value <= 20:
                signals['stochastic'] = 'buy'
            elif d_value is not None and k_value > d_value:
                signals['stochastic'] = 'buy'
            elif d_value is not None and k_value < d_value:
                signals['stochastic'] = 'sell'
            else:
                signals['stochastic'] = 'hold'
    if 'stochastic' not in signals:
        signals['stochastic'] = 'hold'

    macd = indicators.get('macd')
    if isinstance(macd, dict):
        macd_line = macd.get('macd')
        signal_line = macd.get('signal')
        if macd_line is not None and signal_line is not None:
            if macd_line > signal_line:
                signals['macd'] = 'bullish'
            elif macd_line < signal_line:
                signals['macd'] = 'bearish'
            else:
                signals['macd'] = 'neutral'
    if 'macd' not in signals:
        signals['macd'] = 'neutral'

    return signals


def compute_recommendation(
    signals: Dict[str, str], indicators: Dict[str, object]
) -> Dict[str, object]:
    score = 50
    notes: List[str] = []

    sma5 = indicators.get('sma5')
    sma20 = indicators.get('sma20')
    if signals.get('trend') == 'bullish':
        score += 20
        if sma5 is not None and sma20 is not None:
            notes.append(
                f'단기 이동평균({sma5:.2f})이 중기 이동평균({sma20:.2f}) 위에서 움직이고 있습니다.'
            )
        else:
            notes.append('단기 이동평균이 중기 이동평균 위에 있습니다.')
    elif signals.get('trend') == 'bearish':
        score -= 20
        if sma5 is not None and sma20 is not None:
            notes.append(
                f'단기 이동평균({sma5:.2f})이 중기 이동평균({sma20:.2f}) 아래로 내려왔습니다.'
            )
        else:
            notes.append('단기 이동평균이 중기 이동평균 아래로 내려왔습니다.')

    rsi14 = indicators.get('rsi14')
    rsi_signal = signals.get('rsi')
    if rsi_signal == 'buy':
        score += 15
        if rsi14 is not None:
            notes.append(f'RSI {rsi14:.2f} → 과매도 구간 진입 또는 근접입니다.')
    elif rsi_signal == 'sell':
        score -= 15
        if rsi14 is not None:
            notes.append(f'RSI {rsi14:.2f} → 과매수 구간 진입 또는 근접입니다.')

    stochastic = indicators.get('stochastic')
    stochastic_signal = signals.get('stochastic')
    if stochastic_signal == 'buy':
        score += 10
        if isinstance(stochastic, dict) and stochastic.get('k') is not None:
            notes.append(
                f'스토캐스틱 %K {stochastic.get("k"):.2f} → 반등 신호에 무게가 실립니다.'
            )
    elif stochastic_signal == 'sell':
        score -= 10
        if isinstance(stochastic, dict) and stochastic.get('k') is not None:
            notes.append(
                f'스토캐스틱 %K {stochastic.get("k"):.2f} → 과매수 구간 경계가 필요합니다.'
            )

    macd = indicators.get('macd')
    macd_signal = signals.get('macd')
    if macd_signal == 'bullish':
        score += 15
        if isinstance(macd, dict) and macd.get('macd') is not None and macd.get('signal') is not None:
            notes.append(
                f'MACD {macd.get("macd"):.2f}가 시그널 {macd.get("signal"):.2f} 위에 있어 상승 모멘텀이 확인됩니다.'
            )
    elif macd_signal == 'bearish':
        score -= 15
        if isinstance(macd, dict) and macd.get('macd') is not None and macd.get('signal') is not None:
            notes.append(
                f'MACD {macd.get("macd"):.2f}가 시그널 {macd.get("signal"):.2f} 아래에 있어 하락 모멘텀을 경계해야 합니다.'
            )

    clamped_score = max(0, min(100, round(score)))
    action: str
    if clamped_score >= BUY_THRESHOLD:
        action = 'buy'
    elif clamped_score <= SELL_THRESHOLD:
        action = 'sell'
    else:
        action = 'hold'

    recommendation = {
        'score': clamped_score,
        'action': action,
        'notes': notes,
        'thresholds': {'buy': BUY_THRESHOLD, 'sell': SELL_THRESHOLD},
    }

    return recommendation


def load_portfolio_state(symbols: Iterable[str]) -> Dict[str, Dict[str, object]]:
    try:
        raw = json.loads(PORTFOLIO_FILE.read_text(encoding='utf-8'))
    except FileNotFoundError:
        raw = {}
    except json.JSONDecodeError:
        logging.warning('Portfolio file is corrupted. Re-initializing portfolio state.')
        raw = {}

    if isinstance(raw, dict) and 'symbols' in raw and isinstance(raw['symbols'], dict):
        state = raw['symbols']
    elif isinstance(raw, dict):
        state = raw
    else:
        state = {}

    for symbol in symbols:
        entry = state.get(symbol, {})
        entry['cash'] = float(entry.get('cash', INITIAL_CAPITAL))
        entry['shares'] = int(entry.get('shares', 0))
        entry['avg_price'] = float(entry.get('avg_price', 0.0))
        entry.setdefault('last_action', None)
        entry.setdefault('last_price', None)
        state[symbol] = entry

    return state


def save_portfolio_state(state: Dict[str, Dict[str, object]]) -> None:
    payload = {
        'updated_at': datetime.now(tz=UTC_TZ).isoformat(),
        'symbols': state,
    }
    PORTFOLIO_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')


def update_portfolio_entry(
    entry: Dict[str, object], price: float, action: str
) -> Dict[str, object]:
    timestamp = datetime.now(tz=UTC_TZ).isoformat()
    transaction = {
        'type': 'hold',
        'units': 0,
        'price': price,
        'value': 0.0,
        'timestamp': timestamp,
    }

    if price is None or price <= 0:
        entry['last_action'] = transaction
        entry['last_price'] = price
        return entry

    if action == 'buy':
        affordable_units = int(entry.get('cash', 0) // price)
        if affordable_units > 0:
            cost = affordable_units * price
            entry['cash'] = float(entry.get('cash', 0) - cost)
            existing_value = entry.get('shares', 0) * entry.get('avg_price', 0)
            total_shares = int(entry.get('shares', 0)) + affordable_units
            if total_shares > 0:
                entry['avg_price'] = float((existing_value + cost) / total_shares)
            entry['shares'] = total_shares
            transaction.update({'type': 'buy', 'units': affordable_units, 'value': cost})
    elif action == 'sell':
        held_units = int(entry.get('shares', 0))
        if held_units > 0:
            proceeds = held_units * price
            entry['cash'] = float(entry.get('cash', 0) + proceeds)
            entry['shares'] = 0
            entry['avg_price'] = 0.0
            transaction.update({'type': 'sell', 'units': held_units, 'value': proceeds})

    entry['cash'] = float(round(entry.get('cash', 0.0), 2))
    entry['avg_price'] = float(round(entry.get('avg_price', 0.0), 2)) if entry.get('shares', 0) else 0.0
    transaction['value'] = float(round(transaction['value'], 2))
    entry['last_action'] = transaction
    entry['last_price'] = price

    return entry


def format_timestamp(index: Iterable[pd.Timestamp]) -> List[str]:
    formatted: List[str] = []
    for ts in index:
        if ts.tzinfo is None:
            ts = ts.tz_localize(SEOUL_TZ)
        formatted.append(ts.tz_convert(UTC_TZ).isoformat())
    return formatted


def download_history(ticker: yf.Ticker, symbol: str) -> pd.DataFrame:
    history = ticker.history(period='3mo', interval='1d', auto_adjust=False)

    if history.empty:
        raise RuntimeError(f'No price data returned for {symbol}')

    history = history.dropna(subset=['Close'])
    return history


def prepare_history_payload(history: pd.DataFrame) -> List[Dict[str, float | str]]:
    trimmed = history[['Open', 'High', 'Low', 'Close', 'Volume']].tail(PRICE_CHART_DAYS).copy()
    trimmed.columns = ['open', 'high', 'low', 'close', 'volume']

    timestamps = format_timestamp(trimmed.index)
    payload: List[Dict[str, float | str]] = []
    for ts, row in zip(timestamps, trimmed.itertuples(index=False)):
        payload.append(
            {
                'timestamp': ts,
                'open': float(row.open),
                'high': float(row.high),
                'low': float(row.low),
                'close': float(row.close),
                'volume': float(row.volume),
            }
        )
    return payload


def update_history_csv(symbol: str, history: pd.DataFrame) -> None:
    df = history.reset_index()
    timestamp_col = df.columns[0]
    df.rename(columns={timestamp_col: 'timestamp'}, inplace=True)

    timestamp_series = (
        df['timestamp']
        if pd.api.types.is_datetime64_any_dtype(df['timestamp'])
        else pd.to_datetime(df['timestamp'], errors='coerce')
    )

    if timestamp_series.dt.tz is None:
        timestamp_series = timestamp_series.dt.tz_localize(SEOUL_TZ)
    timestamp_series = timestamp_series.dt.tz_convert(UTC_TZ)
    df['timestamp'] = timestamp_series.dt.strftime('%Y-%m-%dT%H:%M:%SZ')

    df = df[['timestamp', 'Open', 'High', 'Low', 'Close', 'Volume']]

    csv_path = HISTORY_DIR / f'{symbol.replace(".", "_")}.csv'
    if csv_path.exists():
        existing = pd.read_csv(csv_path)
        combined = (
            pd.concat([existing, df], ignore_index=True)
            .drop_duplicates(subset=['timestamp'])
            .sort_values('timestamp')
        )
    else:
        combined = df

    combined.to_csv(csv_path, index=False)


def fetch_news(symbol: str, metadata: Dict[str, str], ticker: yf.Ticker) -> List[Dict[str, str | None]]:
    news_items: List[Dict[str, str | None]] = []

    try:
        primary_news = ticker.news or []
    except Exception as exc:  # noqa: BLE001 - log and continue
        logging.warning('Primary news lookup failed for %s: %s', symbol, exc)
        primary_news = []

    for item in primary_news:
        publish_time = item.get('providerPublishTime')
        published_at = (
            datetime.fromtimestamp(publish_time, tz=UTC_TZ).isoformat()
            if publish_time
            else None
        )
        news_items.append(
            {
                'title': item.get('title'),
                'publisher': item.get('publisher'),
                'link': item.get('link'),
                'published_at': published_at,
            }
        )

    if len(news_items) >= 5:
        return news_items[:5]

    query = metadata.get('name') or symbol
    try:
        response = requests.get(
            'https://query1.finance.yahoo.com/v1/finance/search',
            params={'q': query, 'lang': 'ko-KR', 'newsCount': 5},
            timeout=10,
        )
        response.raise_for_status()
        payload = response.json()
        for item in payload.get('news', []):
            published_raw = item.get('providerPublishTime') or item.get('pubtime')
            published_at = (
                datetime.fromtimestamp(published_raw, tz=UTC_TZ).isoformat()
                if published_raw
                else None
            )
            news_items.append(
                {
                    'title': item.get('title'),
                    'publisher': item.get('publisher'),
                    'link': item.get('link'),
                    'published_at': published_at,
                }
            )
    except Exception as exc:  # noqa: BLE001 - best-effort fallback
        logging.warning('Fallback news lookup failed for %s: %s', symbol, exc)

    deduped: List[Dict[str, str | None]] = []
    seen_links = set()
    for item in news_items:
        link = item.get('link')
        if link and link in seen_links:
            continue
        if link:
            seen_links.add(link)
        deduped.append(item)
        if len(deduped) == 5:
            break

    return deduped


def build_snapshot() -> Dict[str, object]:
    tickers_payload = []
    errors = []

    portfolio_state = load_portfolio_state(TICKERS.keys())
    generated_at = datetime.now(tz=UTC_TZ).isoformat()

    for symbol, metadata in TICKERS.items():
        logging.info('Fetching data for %s', symbol)
        ticker = yf.Ticker(symbol)
        try:
            history = download_history(ticker, symbol)
            indicators = compute_indicators(history)
            signals = build_signals(indicators)
            recommendation = compute_recommendation(signals, indicators)
            update_history_csv(symbol, history)
            news = fetch_news(symbol, metadata, ticker)
        except Exception as exc:  # noqa: BLE001 - log and continue
            logging.exception('Failed to update %s', symbol)
            errors.append(f'{symbol}: {exc}')
            continue

        history_payload = prepare_history_payload(history)
        latest_close = float(history['Close'].iloc[-1])
        latest_index = history.index[-1]
        if latest_index.tzinfo is None:
            latest_index = latest_index.tz_localize(SEOUL_TZ)
        latest_timestamp = latest_index.tz_convert(UTC_TZ).isoformat()

        entry = update_portfolio_entry(portfolio_state[symbol], latest_close, recommendation['action'])
        portfolio_state[symbol] = entry
        market_value = float(entry.get('shares', 0)) * latest_close
        portfolio_details = {
            'cash': float(round(entry.get('cash', 0.0), 2)),
            'shares': int(entry.get('shares', 0)),
            'average_price': (float(round(entry.get('avg_price', 0.0), 2)) if entry.get('shares', 0) else None),
            'market_price': latest_close,
            'market_value': float(round(market_value, 2)),
            'total_value': float(round(entry.get('cash', 0.0) + market_value, 2)),
            'last_action': entry.get('last_action'),
        }
        entry['last_price'] = latest_close

        tickers_payload.append(
            {
                'symbol': symbol,
                'name': metadata['name'],
                'market': metadata['market'],
                'currency': 'KRW',
                'latest': {
                    'close': latest_close,
                    'timestamp': latest_timestamp,
                },
                'history': history_payload,
                'indicators': indicators,
                'signals': signals,
                'recommendation': recommendation,
                'portfolio': portfolio_details,
                'news': news,
            }
        )

    if not tickers_payload:
        raise RuntimeError('No ticker data could be fetched')

    total_cash = 0.0
    total_market_value = 0.0
    for symbol, entry in portfolio_state.items():
        cash = float(entry.get('cash', 0.0))
        shares = float(entry.get('shares', 0))
        last_price = entry.get('last_price')
        last_price_value = float(last_price) if last_price else 0.0
        total_cash += cash
        total_market_value += shares * last_price_value

    portfolio_summary = {
        'total_cash': float(round(total_cash, 2)),
        'total_market_value': float(round(total_market_value, 2)),
        'total_value': float(round(total_cash + total_market_value, 2)),
        'initial_capital_per_symbol': INITIAL_CAPITAL,
        'initial_total': INITIAL_CAPITAL * len(TICKERS),
        'updated_at': generated_at,
    }

    save_portfolio_state(portfolio_state)

    snapshot = {
        'generated_at': generated_at,
        'tickers': tickers_payload,
        'portfolio_summary': portfolio_summary,
    }

    if errors:
        snapshot['errors'] = errors

    return snapshot


def main() -> None:
    snapshot = build_snapshot()
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SNAPSHOT_FILE.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding='utf-8')
    logging.info('Snapshot saved to %s', SNAPSHOT_FILE)


if __name__ == '__main__':
    main()
