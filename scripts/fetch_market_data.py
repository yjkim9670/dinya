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
PRICE_CHART_DAYS = 10

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

    for symbol, metadata in TICKERS.items():
        logging.info('Fetching data for %s', symbol)
        ticker = yf.Ticker(symbol)
        try:
            history = download_history(ticker, symbol)
            indicators = compute_indicators(history)
            signals = build_signals(indicators)
            update_history_csv(symbol, history)
            news = fetch_news(symbol, metadata, ticker)
        except Exception as exc:  # noqa: BLE001 - log and continue
            logging.exception('Failed to update %s', symbol)
            errors.append(f'{symbol}: {exc}')
            continue

        tickers_payload.append(
            {
                'symbol': symbol,
                'name': metadata['name'],
                'market': metadata['market'],
                'currency': 'KRW',
                'history': prepare_history_payload(history),
                'indicators': indicators,
                'signals': signals,
                'news': news,
            }
        )

    if not tickers_payload:
        raise RuntimeError('No ticker data could be fetched')

    snapshot = {
        'generated_at': datetime.now(tz=UTC_TZ).isoformat(),
        'tickers': tickers_payload,
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
