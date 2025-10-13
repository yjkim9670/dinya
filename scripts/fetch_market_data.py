#!/usr/bin/env python3
"""Fetch Korean equity and ETF data for the dashboard."""

from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Dict, Iterable, List
from zoneinfo import ZoneInfo

import pandas as pd
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

logging.basicConfig(level=logging.INFO, format='[%(levelname)s] %(message)s')

HISTORY_DIR.mkdir(parents=True, exist_ok=True)


def compute_rsi(series: pd.Series, period: int = 14) -> float | None:
    if series.size < period + 1:
        return None

    delta = series.diff()
    gains = delta.clip(lower=0)
    losses = -delta.clip(upper=0)
    avg_gain = gains.ewm(alpha=1 / period, adjust=False).mean()
    avg_loss = losses.ewm(alpha=1 / period, adjust=False).mean()
    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))
    return float(rsi.iloc[-1])


def compute_indicators(close: pd.Series) -> Dict[str, float | None]:
    indicators: Dict[str, float | None] = {
        'sma5': float(close.tail(5).mean()) if close.size >= 5 else None,
        'sma20': float(close.tail(20).mean()) if close.size >= 20 else None,
        'rsi14': compute_rsi(close, 14),
    }
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
            signals['momentum'] = 'overbought'
        elif rsi14 <= 30:
            signals['momentum'] = 'oversold'
        else:
            signals['momentum'] = 'neutral'
    else:
        signals['momentum'] = 'neutral'

    return signals


def format_timestamp(index: Iterable[pd.Timestamp]) -> List[str]:
    formatted: List[str] = []
    for ts in index:
        if ts.tzinfo is None:
            ts = ts.tz_localize(SEOUL_TZ)
        formatted.append(ts.tz_convert(UTC_TZ).isoformat())
    return formatted


def download_history(ticker: yf.Ticker, symbol: str) -> pd.DataFrame:
    history = ticker.history(period='1d', interval='1m', auto_adjust=False)

    if history.empty:
        logging.warning('%s returned no 1m data, falling back to 5m interval.', symbol)
        history = ticker.history(period='5d', interval='5m', auto_adjust=False)

    if history.empty:
        raise RuntimeError(f'No price data returned for {symbol}')

    return history


def prepare_history_payload(history: pd.DataFrame) -> List[Dict[str, float | str]]:
    trimmed = history[['Open', 'High', 'Low', 'Close', 'Volume']].copy()
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


def fetch_news(ticker: yf.Ticker) -> List[Dict[str, str | None]]:
    news_items: List[Dict[str, str | None]] = []
    for item in (ticker.news or [])[:5]:
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
    return news_items


def build_snapshot() -> Dict[str, object]:
    tickers_payload = []
    errors = []

    for symbol, metadata in TICKERS.items():
        logging.info('Fetching data for %s', symbol)
        ticker = yf.Ticker(symbol)
        try:
            history = download_history(ticker, symbol)
            close = history['Close']
            indicators = compute_indicators(close)
            signals = build_signals(indicators)
            update_history_csv(symbol, history)
            news = fetch_news(ticker)
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
