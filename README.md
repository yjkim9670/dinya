# Korean Market Monitoring Dashboard

This repository hosts a GitHub Pages friendly dashboard for tracking leading Korean equities and exchange-traded funds (ETFs). The focus is on:

- **Samsung Electronics (KRX:005930)**
- **SK hynix (KRX:000660)**
- **TIGER S&P500 ETF (KRX:360750)**
- **TIGER NASDAQ 100 ETF (KRX:133690)**

The site aggregates near real-time price history, common indicators, simple trading signals, and links to the latest news stories so that everything is visible at a glance.

## Project layout

```text
.
├── AGENTS.md                # Repository guidelines
├── README.md                # Project documentation and setup notes
├── assets/
│   ├── app.js               # Client-side dashboard logic
│   └── styles.css           # Visual theme for the dashboard
├── data/
│   ├── history/             # CSV time-series snapshots kept by the workflow
│   └── latest.json          # Most recent snapshot consumed by the dashboard
├── index.html               # GitHub Pages entry point
├── requirements.txt         # Python dependencies for scheduled updates
├── scripts/
│   └── fetch_market_data.py # Data ingestion script used by automation
└── .github/workflows/
    └── update-data.yml      # Hourly GitHub Actions workflow that refreshes data
```

## Local development

1. Install Python 3.10+ and Node-free tooling (the dashboard is static and uses CDN hosted libraries).
2. Create and activate a virtual environment if desired.
3. Install dependencies and run the data fetcher:

   ```bash
   pip install -r requirements.txt
   python scripts/fetch_market_data.py
   ```

   The script fetches 1-minute bars for each ticker, calculates a few simple indicators (SMA and RSI), evaluates basic buy/sell signals, stores rolling history in `data/history/`, and writes the freshest snapshot to `data/latest.json` for the dashboard.

4. Open `index.html` in a browser (or serve the directory with any static server) to view the latest data.

## Automated updates on GitHub Pages

GitHub Pages serves the static dashboard from the repository. To keep content updated without manual intervention, the repository defines a scheduled GitHub Actions workflow (`.github/workflows/update-data.yml`) that:

1. Runs every hour.
2. Uses the same Python script to pull fresh market data via `yfinance`.
3. Commits any changes in `data/latest.json` or the `data/history/` CSVs back to the default branch.

Because the workflow relies on public data sources exposed through `yfinance`, it does not require API keys. Nevertheless, intraday access can occasionally be rate limited or paused by the upstream provider. When that happens the workflow skips committing changes and will try again on the next run.

### Handling credentials for pushes

The workflow leverages the repository-provided `GITHUB_TOKEN`, which is enabled by default. No extra configuration is needed unless branch protection rules require a different automation strategy (for example, sending pull requests instead of direct commits).

## Understanding the indicators and signals

For each instrument the script currently computes:

- **SMA-5 / SMA-20**: Simple moving averages over the last 5 and 20 closing prices.
- **RSI-14**: Relative Strength Index using 14 periods.
- **Signal summary**:
  - *Trend*: Bullish when SMA-5 exceeds SMA-20, bearish when the opposite holds, neutral otherwise.
  - *Momentum*: Overbought when RSI ≥ 70, oversold when RSI ≤ 30, neutral otherwise.

These rules are intentionally lightweight. You can extend `scripts/fetch_market_data.py` to calculate additional indicators such as MACD, Bollinger Bands, or custom signals as needed.

## News aggregation

`yfinance` exposes a small feed of relevant news for each ticker. The script stores the latest items (capped at five per instrument) in `data/latest.json` so the dashboard can surface headlines alongside the chart.

## Real-time expectations

GitHub Pages hosts a static site, so true tick-by-tick real-time data is not possible. The combination of scheduled workflow updates and client-side polling provides "near real-time" coverage constrained by:

- The frequency of GitHub Actions (the provided workflow runs hourly; you can adjust the cron schedule to every 15 minutes if API rate limits allow).
- The latency of upstream data sources (`yfinance` data is typically delayed by a few minutes).
- Browser caching (the dashboard appends a cache-busting timestamp when requesting `latest.json`).

If you require second-by-second updates or guaranteed low-latency data, consider hosting the dashboard on infrastructure that supports background jobs or websockets and using a commercial market data API.

## Next steps

- Tune the indicator calculations or add additional analytics.
- Add localization or multi-language support for the dashboard text.
- Expand alerting by integrating webhook notifications triggered by specific signals.

Contributions and refinements are welcome—please keep the documentation and tests up to date as the project grows.
