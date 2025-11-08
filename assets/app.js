const DATA_URL = 'data/latest.json';
const REFRESH_INTERVAL = 20 * 60 * 1000;

const dashboard = document.getElementById('dashboard');
const categoryNav = document.getElementById('category-nav');
const lastUpdated = document.getElementById('last-updated');
const portfolioOverview = document.getElementById('portfolio-overview');

const DEFAULT_CHART_DAYS = 30;
const MAX_CHART_DAYS = 180;
const CHART_RANGE_STEP = 5;
const BUY_THRESHOLD = 80;
const SELL_THRESHOLD = 20;

const dateLabelFormatter = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const CATEGORY_DEFINITIONS = [
  {
    id: 'stocks',
    label: '국내 대표주',
    description: '삼성전자와 SK하이닉스 중심의 국내 주도주 흐름을 모니터링합니다.',
    symbols: ['005930.KS', '000660.KS'],
  },
  {
    id: 'etfs',
    label: '글로벌 ETF',
    description: 'TIGER S&P500과 TIGER 나스닥100 ETF를 통해 해외 증시 트렌드를 추적합니다.',
    symbols: ['360750.KS', '133690.KS'],
  },
];

let activeCategory = CATEGORY_DEFINITIONS[0]?.id ?? null;
let renderedCategories = [...CATEGORY_DEFINITIONS];
const categoryPanels = new Map();

const chartInstances = new Map();
const chartEventDisposers = new Map();
const chartRangeSelections = new Map();

let autoRefreshTimerId = null;

const priceFormatters = new Map();

const percentFormatter = new Intl.NumberFormat('ko-KR', {
  style: 'percent',
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

const SIGNAL_LABELS = {
  trend: '추세',
  rsi: 'RSI',
  stochastic: '스토캐스틱',
  macd: 'MACD',
};

const SIGNAL_DESCRIPTIONS = {
  trend: {
    bullish: '상승 추세 (단기 > 중기)',
    bearish: '하락 추세 (단기 < 중기)',
    neutral: '추세 중립',
  },
  rsi: {
    buy: '매수 우위 (RSI ≤ 30)',
    sell: '매도 우위 (RSI ≥ 70)',
    hold: '중립 (RSI 30~70)',
  },
  stochastic: {
    buy: '과매도 반등 가능성 (%K ≤ 20)',
    sell: '과매수 조정 가능성 (%K ≥ 80)',
    hold: '중립 (신호 대기)',
  },
  macd: {
    bullish: '상승 모멘텀 (MACD > Signal)',
    bearish: '하락 모멘텀 (MACD < Signal)',
    neutral: '중립 (교차 없음)',
  },
};

const SIGNAL_STYLES = {
  bullish: 'positive',
  buy: 'positive',
  oversold: 'positive',
  bearish: 'negative',
  sell: 'negative',
  overbought: 'negative',
};

const ACTION_LABELS = {
  buy: '매수',
  sell: '매도',
  hold: '관망',
};

const ACTION_BADGE_CLASS = {
  buy: 'badge-buy',
  sell: 'badge-sell',
  hold: 'badge-hold',
};

const indicatorNumberFormatter = new Intl.NumberFormat('ko-KR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

async function fetchSnapshot() {
  const cacheBuster = `?t=${Date.now()}`;
  const response = await fetch(`${DATA_URL}${cacheBuster}`);

  if (!response.ok) {
    throw new Error(`데이터를 불러오지 못했습니다 (${response.status})`);
  }

  return response.json();
}

function ensurePriceFormatter(currency) {
  if (!currency) return new Intl.NumberFormat('ko-KR');
  if (!priceFormatters.has(currency)) {
    try {
      priceFormatters.set(
        currency,
        new Intl.NumberFormat('ko-KR', {
          style: 'currency',
          currency,
          maximumFractionDigits: currency === 'KRW' ? 0 : 2,
        })
      );
    } catch (error) {
      priceFormatters.set(currency, new Intl.NumberFormat('ko-KR'));
    }
  }
  return priceFormatters.get(currency);
}

function formatLastAction(action, priceFormatter) {
  if (!action || typeof action !== 'object') {
    return '최근 자동 매매 내역이 없습니다.';
  }

  const timestamp = action.timestamp ? formatRelativeTime(action.timestamp) : '시간 정보 없음';
  const units = action.units ?? 0;
  const price = action.price != null ? priceFormatter.format(action.price) : '---';
  const value = action.value != null ? priceFormatter.format(action.value) : '---';

  switch (action.type) {
    case 'buy':
      if (units > 0) {
        return `${timestamp} · ${units}주 매수 @ ${price} (총 ${value})`;
      }
      return `${timestamp} · 매수 조건이 충족됐으나 가용 현금이 부족했습니다.`;
    case 'sell':
      if (units > 0) {
        return `${timestamp} · ${units}주 매도 @ ${price} (총 ${value})`;
      }
      return `${timestamp} · 매도 조건이 충족됐으나 보유 수량이 없습니다.`;
    default:
      return `${timestamp} · 관망 중입니다.`;
  }
}

function groupTickers(tickers = []) {
  const grouped = new Map(CATEGORY_DEFINITIONS.map((category) => [category.id, []]));
  const uncategorized = [];

  tickers.forEach((ticker) => {
    const category = CATEGORY_DEFINITIONS.find((entry) => entry.symbols.includes(ticker.symbol));
    if (category) {
      grouped.get(category.id)?.push(ticker);
    } else {
      uncategorized.push(ticker);
    }
  });

  return { grouped, uncategorized };
}

function createRecommendationSection(ticker) {
  const section = document.createElement('section');
  section.className = 'card-section recommendation';

  const header = document.createElement('div');
  header.className = 'section-header';
  const title = document.createElement('h3');
  title.textContent = '매매 추천';
  header.appendChild(title);
  section.appendChild(header);

  const recommendation = ticker.recommendation;
  if (!recommendation) {
    const empty = document.createElement('p');
    empty.className = 'empty-text';
    empty.textContent = '추천 정보를 불러오지 못했습니다.';
    section.appendChild(empty);
    return section;
  }

  const action = recommendation.action ?? 'hold';
  const badge = document.createElement('span');
  badge.className = `action-badge ${ACTION_BADGE_CLASS[action] ?? ACTION_BADGE_CLASS.hold}`;
  badge.textContent = ACTION_LABELS[action] ?? ACTION_LABELS.hold;
  header.appendChild(badge);

  const scoreWrapper = document.createElement('div');
  scoreWrapper.className = 'score-wrapper';

  const scoreValue = document.createElement('div');
  scoreValue.className = 'score-value';
  const scoreStrong = document.createElement('strong');
  scoreStrong.textContent = recommendation.score != null ? recommendation.score.toString() : '--';
  const scoreUnit = document.createElement('span');
  scoreUnit.textContent = '점';
  scoreValue.append(scoreStrong, scoreUnit);

  const scoreBar = document.createElement('div');
  scoreBar.className = 'score-bar';
  const scoreFill = document.createElement('div');
  scoreFill.className = `score-bar-fill ${action}`;
  scoreFill.style.width = `${recommendation.score ?? 0}%`;
  scoreBar.appendChild(scoreFill);

  scoreWrapper.append(scoreValue, scoreBar);

  const threshold = document.createElement('p');
  threshold.className = 'score-threshold';
  const buyThreshold = recommendation.thresholds?.buy ?? BUY_THRESHOLD;
  const sellThreshold = recommendation.thresholds?.sell ?? SELL_THRESHOLD;
  threshold.textContent = `자동 매매 기준: ${buyThreshold}점 이상 매수 · ${sellThreshold}점 이하 매도`;

  const notes = document.createElement('ul');
  notes.className = 'recommendation-notes';
  if (Array.isArray(recommendation.notes) && recommendation.notes.length > 0) {
    recommendation.notes.forEach((note) => {
      const li = document.createElement('li');
      li.textContent = note;
      notes.appendChild(li);
    });
  } else {
    const li = document.createElement('li');
    li.textContent = '지표 기반 설명이 없습니다.';
    notes.appendChild(li);
  }

  section.append(scoreWrapper, threshold, notes);
  return section;
}

function createPortfolioSection(ticker, priceFormatter) {
  const section = document.createElement('section');
  section.className = 'card-section portfolio';

  const header = document.createElement('div');
  header.className = 'section-header';
  const title = document.createElement('h3');
  title.textContent = '모의투자 현황';
  header.appendChild(title);
  section.appendChild(header);

  const portfolio = ticker.portfolio;
  if (!portfolio) {
    const empty = document.createElement('p');
    empty.className = 'empty-text';
    empty.textContent = '포트폴리오 데이터가 없습니다.';
    section.appendChild(empty);
    return section;
  }

  const portfolioGrid = document.createElement('div');
  portfolioGrid.className = 'portfolio-grid';
  const metrics = [
    {
      label: '가용 현금',
      value: priceFormatter.format(portfolio.cash ?? 0),
    },
    {
      label: '보유 수량',
      value: `${portfolio.shares ?? 0}주`,
    },
    {
      label: '평균 매입가',
      value:
        portfolio.average_price != null
          ? priceFormatter.format(portfolio.average_price)
          : '---',
    },
    {
      label: '평가 금액',
      value: priceFormatter.format(portfolio.market_value ?? 0),
    },
    {
      label: '총 자산',
      value: priceFormatter.format(portfolio.total_value ?? 0),
    },
  ];

  metrics.forEach(({ label, value }) => {
    const item = document.createElement('div');
    item.className = 'portfolio-item';
    const heading = document.createElement('h4');
    heading.textContent = label;
    const content = document.createElement('p');
    content.textContent = value;
    item.append(heading, content);
    portfolioGrid.appendChild(item);
  });

  const lastAction = document.createElement('p');
  lastAction.className = 'portfolio-last-action';
  lastAction.textContent = formatLastAction(portfolio.last_action, priceFormatter);

  section.append(portfolioGrid, lastAction);
  return section;
}

function createCard(ticker) {
  const card = document.createElement('article');
  card.className = 'card';

  const header = document.createElement('div');
  header.className = 'card-header';

  const title = document.createElement('h2');
  title.textContent = `${ticker.name}`;

  const subtitle = document.createElement('span');
  subtitle.textContent = `${ticker.symbol} · ${ticker.market || '시장 미상'}`;

  header.append(title, subtitle);

  const chartContainer = document.createElement('div');
  chartContainer.className = 'chart-container';

  const availableHistoryDays = Array.isArray(ticker.history) ? ticker.history.length : 0;
  const derivedMax = availableHistoryDays > 0 ? Math.min(MAX_CHART_DAYS, availableHistoryDays) : DEFAULT_CHART_DAYS;
  const sliderMax = Math.max(1, derivedMax);
  const sliderMin = Math.min(DEFAULT_CHART_DAYS, sliderMax);
  const savedRange = chartRangeSelections.get(ticker.symbol);
  const initialRange = savedRange
    ? Math.min(sliderMax, Math.max(sliderMin, Number(savedRange)))
    : sliderMin;

  const controls = document.createElement('div');
  controls.className = 'chart-controls';

  const rangeSummary = document.createElement('span');
  rangeSummary.className = 'chart-range-summary';
  const updateRangeSummary = (value) => {
    const limitedByData = sliderMin === sliderMax && availableHistoryDays < DEFAULT_CHART_DAYS;
    rangeSummary.textContent = `표시 구간: 최근 ${value}거래일${limitedByData ? ' (데이터 한도)' : ''}`;
  };
  updateRangeSummary(initialRange);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(sliderMin);
  slider.max = String(sliderMax);
  slider.step = String(CHART_RANGE_STEP);
  slider.value = String(initialRange);
  slider.setAttribute('aria-label', '차트 표시 구간 (최근 거래일 수)');
  slider.disabled = sliderMin === sliderMax;

  controls.append(rangeSummary, slider);

  const canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `${ticker.name} 가격 차트`);
  const info = document.createElement('div');
  info.className = 'chart-info';
  const infoDate = document.createElement('span');
  infoDate.className = 'info-date';
  infoDate.textContent = '날짜: --';
  const infoValue = document.createElement('span');
  infoValue.className = 'info-value';
  infoValue.textContent = '종가: --';
  const infoId = `chart-info-${ticker.symbol
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .toLowerCase()}-${Math.random().toString(36).slice(2, 7)}`;
  info.id = infoId;
  info.append(infoDate, infoValue);
  chartContainer.append(controls, canvas, info);
  canvas.setAttribute('aria-describedby', infoId);

  const meta = document.createElement('div');
  meta.className = 'meta';

  const priceFormatter = ensurePriceFormatter(ticker.currency || 'KRW');
  const latest = ticker.history?.[ticker.history.length - 1];
  const prev = ticker.history?.[ticker.history.length - 2];
  const change = latest && prev ? latest.close - prev.close : null;
  const changePct = latest && prev && prev.close !== 0 ? change / prev.close : null;

  const priceChange =
    change != null
      ? `${change >= 0 ? '+' : '-'}${priceFormatter.format(Math.abs(change))}`
      : null;
  const percentChange =
    changePct != null
      ? `${change >= 0 ? '+' : '-'}${percentFormatter.format(Math.abs(changePct))}`
      : null;

  const metaItems = [
    {
      label: '현재가',
      value:
        latest?.close != null ? priceFormatter.format(latest.close) : '데이터 없음',
      className: change != null ? (change >= 0 ? 'positive' : 'negative') : undefined,
    },
    {
      label: '이전 대비',
      value:
        priceChange
          ? percentChange
            ? `${priceChange} (${percentChange})`
            : priceChange
          : '데이터 없음',
      className: change != null ? (change >= 0 ? 'positive' : 'negative') : undefined,
    },
    {
      label: '5일 이동평균',
      value:
        ticker.indicators?.sma5 != null
          ? priceFormatter.format(ticker.indicators.sma5)
          : '계산 불가',
      className:
        ticker.indicators?.sma5 != null && ticker.indicators?.sma20 != null
          ? ticker.indicators.sma5 >= ticker.indicators.sma20
            ? 'positive'
            : 'negative'
          : undefined,
    },
    {
      label: '20일 이동평균',
      value:
        ticker.indicators?.sma20 != null
          ? priceFormatter.format(ticker.indicators.sma20)
          : '계산 불가',
    },
  ];

  metaItems.forEach(({ label, value, className }) => {
    const item = document.createElement('div');
    item.className = 'meta-item';
    const heading = document.createElement('h3');
    heading.textContent = label;
    const content = document.createElement('p');
    content.textContent = value;
    if (className) {
      content.classList.add(className);
    }
    item.append(heading, content);
    meta.appendChild(item);
  });

  const indicatorSection = document.createElement('section');
  indicatorSection.className = 'indicators';
  const indicatorTitle = document.createElement('h3');
  indicatorTitle.textContent = '기술적 지표';
  indicatorSection.appendChild(indicatorTitle);

  const indicatorGrid = document.createElement('div');
  indicatorGrid.className = 'indicator-grid';

  const stochastic = ticker.indicators?.stochastic;
  const macd = ticker.indicators?.macd;

  const indicatorItems = [
    {
      label: 'RSI (14)',
      value:
        ticker.indicators?.rsi14 != null
          ? indicatorNumberFormatter.format(ticker.indicators.rsi14)
          : '계산 불가',
    },
    {
      label: '스토캐스틱 (14, 3, 3)',
      value:
        stochastic?.k != null && stochastic?.d != null
          ? `%K ${indicatorNumberFormatter.format(stochastic.k)} · %D ${indicatorNumberFormatter.format(stochastic.d)}`
          : '계산 불가',
    },
    {
      label: 'MACD (12, 26, 9)',
      value:
        macd?.macd != null && macd?.signal != null && macd?.histogram != null
          ? `MACD ${indicatorNumberFormatter.format(macd.macd)} · Signal ${indicatorNumberFormatter.format(macd.signal)} · Hist ${indicatorNumberFormatter.format(macd.histogram)}`
          : '계산 불가',
    },
  ];

  indicatorItems.forEach(({ label, value }) => {
    const item = document.createElement('div');
    item.className = 'indicator-item';
    const heading = document.createElement('h4');
    heading.textContent = label;
    const content = document.createElement('p');
    content.textContent = value;
    item.append(heading, content);
    indicatorGrid.appendChild(item);
  });

  indicatorSection.appendChild(indicatorGrid);

  const signalsSection = document.createElement('section');
  signalsSection.className = 'signals';
  const signalsTitle = document.createElement('h3');
  signalsTitle.textContent = '시그널 요약';
  signalsSection.appendChild(signalsTitle);

  const tags = document.createElement('div');
  tags.className = 'signal-tags';

  const signals = ticker.signals || {};
  const signalKeys = Object.keys(signals);
  if (signalKeys.length > 0) {
    signalKeys.forEach((key) => {
      const value = signals[key];
      const label = SIGNAL_LABELS[key] || key;
      const description = SIGNAL_DESCRIPTIONS[key]?.[value] || value;
      const pill = document.createElement('span');
      pill.className = 'signal-pill';
      const style = SIGNAL_STYLES[value];
      if (style) {
        pill.classList.add(style);
      }
      pill.textContent = `${label}: ${description}`;
      tags.appendChild(pill);
    });
  } else {
    const pill = document.createElement('span');
    pill.className = 'signal-pill';
    pill.textContent = '시그널 데이터 없음';
    tags.appendChild(pill);
  }

  signalsSection.appendChild(tags);

  const newsSection = document.createElement('section');
  newsSection.className = 'news';

  const newsTitle = document.createElement('h3');
  newsTitle.textContent = '관련 뉴스';
  newsSection.appendChild(newsTitle);

  const newsList = document.createElement('ul');

  const validNews = Array.isArray(ticker.news)
    ? ticker.news.filter((item) => item && item.title && item.link)
    : [];

  if (validNews.length > 0) {
    validNews.forEach((item) => {
      const li = document.createElement('li');
      const link = document.createElement('a');
      link.href = item.link;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      const title = document.createElement('strong');
      title.textContent = item.title;
      const meta = document.createElement('span');
      meta.textContent = `${item.publisher ?? '출처 미상'} · ${formatRelativeTime(item.published_at)}`;
      link.append(title, meta);
      li.appendChild(link);
      newsList.appendChild(li);
    });
  } else {
    const li = document.createElement('li');
    li.className = 'news-empty';
    li.innerHTML =
      '<span>표시할 뉴스가 없습니다. RSS 또는 뉴스 API를 <code>scripts/fetch_market_data.py</code>에 연동하면 링크를 노출할 수 있습니다.</span>';
    newsList.appendChild(li);
  }

  newsSection.appendChild(newsList);

  const recommendationSection = createRecommendationSection(ticker);
  const portfolioSection = createPortfolioSection(ticker, priceFormatter);

  card.append(
    header,
    chartContainer,
    meta,
    recommendationSection,
    portfolioSection,
    indicatorSection,
    signalsSection,
    newsSection
  );

  const handleRangeChange = (event) => {
    const value = Number(event.target.value);
    chartRangeSelections.set(ticker.symbol, value);
    updateRangeSummary(value);
    renderChart(canvas, ticker, value);
  };

  slider.addEventListener('input', handleRangeChange);

  requestAnimationFrame(() => {
    renderChart(canvas, ticker, initialRange);
  });

  return card;
}

function renderChart(canvas, ticker, rangeDays = DEFAULT_CHART_DAYS) {
  if (chartEventDisposers.has(canvas)) {
    chartEventDisposers.get(canvas)?.();
    chartEventDisposers.delete(canvas);
  }
  if (chartInstances.has(canvas)) {
    chartInstances.get(canvas)?.destroy();
    chartInstances.delete(canvas);
  }

  const fullHistory = Array.isArray(ticker.history) ? ticker.history : [];
  const limit = Math.max(1, Math.min(rangeDays, fullHistory.length || rangeDays));
  const limitedHistory = fullHistory.slice(-limit);
  const labels = limitedHistory.map((entry) => new Date(entry.timestamp));
  const data = limitedHistory.map((entry) => entry.close);
  const priceFormatter = ensurePriceFormatter(ticker.currency || 'KRW');

  // Filter trading signals within the displayed range
  const tradingSignals = Array.isArray(ticker.trading_signals) ? ticker.trading_signals : [];
  const startTimestamp = limitedHistory[0]?.timestamp;
  const endTimestamp = limitedHistory[limitedHistory.length - 1]?.timestamp;

  const visibleSignals = tradingSignals.filter((signal) => {
    return signal.timestamp >= startTimestamp && signal.timestamp <= endTimestamp;
  });

  // Separate buy and sell signals for different datasets
  const buySignals = visibleSignals
    .filter((signal) => signal.action === 'buy')
    .map((signal) => ({
      x: new Date(signal.timestamp),
      y: signal.price,
    }));

  const sellSignals = visibleSignals
    .filter((signal) => signal.action === 'sell')
    .map((signal) => ({
      x: new Date(signal.timestamp),
      y: signal.price,
    }));

  const infoDate = canvas.parentElement?.querySelector('.info-date');
  const infoValue = canvas.parentElement?.querySelector('.info-value');

  const updateInfo = (entry) => {
    if (!infoDate || !infoValue) {
      return;
    }
    if (!entry) {
      infoDate.textContent = '날짜: --';
      infoValue.textContent = '종가: --';
      return;
    }
    const parsedDate = new Date(entry.timestamp);
    infoDate.textContent = `날짜: ${Number.isNaN(parsedDate.getTime()) ? '--' : dateLabelFormatter.format(parsedDate)}`;
    infoValue.textContent = `종가: ${priceFormatter.format(entry.close ?? 0)}`;
  };

  const latestEntry = limitedHistory[limitedHistory.length - 1] ?? null;
  updateInfo(latestEntry);

  const datasets = [
    {
      label: '종가',
      data,
      fill: false,
      borderColor: '#4db8ff',
      backgroundColor: 'rgba(77, 184, 255, 0.15)',
      tension: 0.35,
      borderWidth: 2,
      pointRadius: 2,
      pointHoverRadius: 6,
      pointHitRadius: 12,
      order: 2,
    },
  ];

  // Add buy signals
  if (buySignals.length > 0) {
    datasets.push({
      label: '매수 시그널',
      data: buySignals,
      type: 'scatter',
      backgroundColor: '#26de81',
      borderColor: '#26de81',
      pointRadius: 8,
      pointHoverRadius: 10,
      pointStyle: 'triangle',
      rotation: 0,
      order: 1,
    });
  }

  // Add sell signals
  if (sellSignals.length > 0) {
    datasets.push({
      label: '매도 시그널',
      data: sellSignals,
      type: 'scatter',
      backgroundColor: '#fc5c65',
      borderColor: '#fc5c65',
      pointRadius: 8,
      pointHoverRadius: 10,
      pointStyle: 'triangle',
      rotation: 180,
      order: 1,
    });
  }

  const chart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'nearest',
        intersect: false,
        axis: 'x',
      },
      scales: {
        x: {
          type: 'time',
          ticks: {
            color: '#a0a4ab',
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 8,
            font: {
              family: "'Source Sans Pro', 'Noto Sans KR', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            },
          },
          time: {
            tooltipFormat: 'yyyy-MM-dd',
            unit: rangeDays > 90 ? 'month' : 'day',
          },
          grid: {
            color: '#3a3f4b',
          },
        },
        y: {
          ticks: {
            color: '#a0a4ab',
            font: {
              family: "'Source Sans Pro', 'Noto Sans KR', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            },
            callback(value) {
              return priceFormatter.format(value);
            },
          },
          grid: {
            color: '#3a3f4b',
          },
        },
      },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: {
            color: '#e4e6eb',
            usePointStyle: true,
            padding: 15,
            font: {
              size: 11,
              family: "'Source Sans Pro', 'Noto Sans KR', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            },
          },
        },
        tooltip: {
          displayColors: true,
          backgroundColor: 'rgba(37, 41, 48, 0.95)',
          titleColor: '#e4e6eb',
          bodyColor: '#e4e6eb',
          borderColor: '#3a3f4b',
          borderWidth: 1,
          titleFont: {
            family: "'Source Sans Pro', 'Noto Sans KR', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          },
          bodyFont: {
            family: "'Source Sans Pro', 'Noto Sans KR', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          },
          callbacks: {
            title(context) {
              const item = context[0];
              if (!item) return '';

              // For scatter points (signals)
              if (item.raw && typeof item.raw === 'object' && item.raw.x) {
                const date = new Date(item.raw.x);
                return Number.isNaN(date.getTime()) ? '' : dateLabelFormatter.format(date);
              }

              // For line points (price)
              const entry = limitedHistory[item.dataIndex];
              if (!entry) return '';
              const parsedDate = new Date(entry.timestamp);
              return Number.isNaN(parsedDate.getTime()) ? '' : dateLabelFormatter.format(parsedDate);
            },
            label(context) {
              if (context.dataset.label === '매수 시그널' || context.dataset.label === '매도 시그널') {
                const price = context.raw.y;
                return `${context.dataset.label}: ${priceFormatter.format(price)}`;
              }
              return `종가: ${priceFormatter.format(context.parsed.y)}`;
            },
          },
        },
      },
    },
  });

  chartInstances.set(canvas, chart);

  const handleEvent = (event) => {
    if (limitedHistory.length === 0) {
      updateInfo(null);
      return;
    }
    const elements = chart.getElementsAtEventForMode(event, 'nearest', { intersect: false }, true);
    if (elements.length > 0) {
      const index = elements[0].index;
      const entry = limitedHistory[index];
      updateInfo(entry ?? latestEntry);
    }
  };

  const handleLeave = () => {
    updateInfo(latestEntry);
  };

  canvas.addEventListener('mousemove', handleEvent);
  canvas.addEventListener('click', handleEvent);
  canvas.addEventListener('mouseleave', handleLeave);

  chartEventDisposers.set(canvas, () => {
    canvas.removeEventListener('mousemove', handleEvent);
    canvas.removeEventListener('click', handleEvent);
    canvas.removeEventListener('mouseleave', handleLeave);
  });
}

function formatRelativeTime(isoString) {
  if (!isoString) return '시간 정보 없음';
  const published = new Date(isoString);
  if (Number.isNaN(published.getTime())) return '시간 정보 없음';

  const diff = Date.now() - published.getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.round(hours / 24);
  return `${days}일 전`;
}

function buildPanels(grouped, categories) {
  categoryPanels.clear();
  dashboard.innerHTML = '';

  categories.forEach((category) => {
    const panel = document.createElement('section');
    panel.className = 'category-panel';
    panel.dataset.category = category.id;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', `${category.id}-tab`);

    const panelHeader = document.createElement('div');
    panelHeader.className = 'panel-header';
    const title = document.createElement('h2');
    title.textContent = category.label;
    const description = document.createElement('p');
    description.textContent = category.description;
    panelHeader.append(title, description);

    const entries = grouped.get(category.id) ?? [];

    panel.appendChild(panelHeader);

    if (entries.length > 0) {
      const grid = document.createElement('div');
      grid.className = 'panel-grid';
      entries.forEach((ticker) => {
        grid.appendChild(createCard(ticker));
      });
      panel.appendChild(grid);
    } else {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = '표시할 종목이 없습니다.';
      panel.appendChild(empty);
    }

    dashboard.appendChild(panel);
    categoryPanels.set(category.id, panel);
  });
}

function buildNav(categories, grouped) {
  categoryNav.innerHTML = '';

  categories.forEach((category) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tab-button';
    button.id = `${category.id}-tab`;
    button.setAttribute('role', 'tab');
    button.dataset.category = category.id;
    const count = grouped.get(category.id)?.length ?? 0;
    button.innerHTML = `
      <span>${category.label}</span>
      <span class="tab-meta">${count}종목</span>
    `;
    button.addEventListener('click', () => setActiveCategory(category.id));
    categoryNav.appendChild(button);
  });
}

function applyActiveCategory() {
  const buttons = categoryNav.querySelectorAll('.tab-button');
  buttons.forEach((button) => {
    const isActive = button.dataset.category === activeCategory;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-selected', String(isActive));
    button.setAttribute('tabindex', isActive ? '0' : '-1');
  });

  categoryPanels.forEach((panel, categoryId) => {
    const isActive = categoryId === activeCategory;
    panel.classList.toggle('active', isActive);
    panel.hidden = !isActive;
    panel.setAttribute('aria-hidden', String(!isActive));
  });
}

function setActiveCategory(categoryId) {
  if (!categoryPanels.has(categoryId)) {
    return;
  }
  activeCategory = categoryId;
  applyActiveCategory();
}

function renderPortfolioOverview(summary) {
  if (!portfolioOverview) {
    return;
  }

  portfolioOverview.innerHTML = '';

  const card = document.createElement('section');
  card.className = 'overview-card card';

  const header = document.createElement('div');
  header.className = 'overview-header';
  const title = document.createElement('h2');
  title.textContent = '모의투자 요약';
  header.appendChild(title);

  if (summary?.updated_at) {
    const updated = document.createElement('span');
    const updatedDate = new Date(summary.updated_at);
    updated.className = 'overview-updated';
    updated.textContent = Number.isNaN(updatedDate.getTime())
      ? '업데이트 시간 정보 없음'
      : `${updatedDate.toLocaleString('ko-KR')} 기준`;
    header.appendChild(updated);
  }

  card.appendChild(header);

  if (!summary) {
    const empty = document.createElement('p');
    empty.className = 'empty-text';
    empty.textContent = '포트폴리오 요약 정보를 불러올 수 없습니다.';
    card.appendChild(empty);
    portfolioOverview.appendChild(card);
    return;
  }

  const formatter = ensurePriceFormatter('KRW');
  const totalValue = summary.total_value ?? null;
  const totalCash = summary.total_cash ?? null;
  const marketValue = summary.total_market_value ?? null;
  const initialTotal = summary.initial_total ?? null;
  const initialPerSymbol = summary.initial_capital_per_symbol ?? null;

  const metrics = document.createElement('div');
  metrics.className = 'overview-metrics';

  const metricItems = [
    {
      label: '총 자산',
      value: totalValue != null ? formatter.format(totalValue) : '---',
      emphasize: true,
    },
    {
      label: '가용 현금',
      value: totalCash != null ? formatter.format(totalCash) : '---',
    },
    {
      label: '보유 평가금액',
      value: marketValue != null ? formatter.format(marketValue) : '---',
    },
    {
      label: '초기 총자본',
      value: initialTotal != null ? formatter.format(initialTotal) : '---',
    },
  ];

  metricItems.forEach(({ label, value, emphasize }) => {
    const item = document.createElement('div');
    item.className = 'overview-metric';
    if (emphasize) {
      item.classList.add('emphasize');
    }
    const heading = document.createElement('h3');
    heading.textContent = label;
    const content = document.createElement('p');
    content.textContent = value;
    item.append(heading, content);
    metrics.appendChild(item);
  });

  card.appendChild(metrics);

  const profitLoss =
    totalValue != null && initialTotal != null ? Number(totalValue) - Number(initialTotal) : null;
  const profitRatio =
    profitLoss != null && initialTotal ? profitLoss / Number(initialTotal) : null;

  if (profitLoss != null) {
    const profit = document.createElement('p');
    profit.className = 'overview-profit';

    if (profitLoss > 0) {
      profit.classList.add('positive');
    } else if (profitLoss < 0) {
      profit.classList.add('negative');
    } else {
      profit.classList.add('neutral');
    }

    const signedValue =
      profitLoss > 0
        ? `+${formatter.format(Math.abs(profitLoss))}`
        : profitLoss < 0
          ? `-${formatter.format(Math.abs(profitLoss))}`
          : formatter.format(0);
    const percentText =
      profitRatio != null
        ? `${profitRatio > 0 ? '+' : profitRatio < 0 ? '-' : ''}${percentFormatter.format(
            Math.abs(profitRatio)
          )}`
        : '';

    profit.textContent = percentText
      ? `누적 손익: ${signedValue} (${percentText})`
      : `누적 손익: ${signedValue}`;

    card.appendChild(profit);
  }

  if (initialPerSymbol != null) {
    const note = document.createElement('p');
    note.className = 'overview-note';
    note.textContent = `종목별 초기 자본은 ${formatter.format(initialPerSymbol)}입니다.`;
    card.appendChild(note);
  }

  portfolioOverview.appendChild(card);
}

function renderDashboard(snapshot) {
  const { grouped, uncategorized } = groupTickers(snapshot.tickers);

  const knownSymbols = new Set((snapshot.tickers ?? []).map((item) => item.symbol));
  chartRangeSelections.forEach((_, symbol) => {
    if (!knownSymbols.has(symbol)) {
      chartRangeSelections.delete(symbol);
    }
  });

  renderPortfolioOverview(snapshot.portfolio_summary);

  renderedCategories = [...CATEGORY_DEFINITIONS];
  if (uncategorized.length > 0) {
    const fallbackId = 'others';
    grouped.set(fallbackId, uncategorized);
    renderedCategories.push({
      id: fallbackId,
      label: '기타 자산',
      description: '사전 정의되지 않은 종목이 자동으로 분류됩니다.',
      symbols: [],
    });
  }

  if (!renderedCategories.some((category) => category.id === activeCategory)) {
    activeCategory = renderedCategories[0]?.id ?? null;
  }

  buildPanels(grouped, renderedCategories);
  buildNav(renderedCategories, grouped);
  applyActiveCategory();

  if (snapshot.generated_at) {
    const generated = new Date(snapshot.generated_at);
    if (!Number.isNaN(generated.getTime())) {
      lastUpdated.textContent = generated.toLocaleString('ko-KR');
    }
  }
}

function renderError(message) {
  dashboard.innerHTML = '';
  categoryNav.innerHTML = '';
  categoryPanels.clear();
  activeCategory = null;

  if (portfolioOverview) {
    portfolioOverview.innerHTML = '';
    const overviewCard = document.createElement('section');
    overviewCard.className = 'overview-card card';
    const overviewMessage = document.createElement('p');
    overviewMessage.className = 'empty-text';
    overviewMessage.textContent = '포트폴리오 요약을 불러올 수 없습니다.';
    overviewCard.appendChild(overviewMessage);
    portfolioOverview.appendChild(overviewCard);
  }

  const errorCard = document.createElement('article');
  errorCard.className = 'card';
  const header = document.createElement('div');
  header.className = 'card-header';
  const title = document.createElement('h2');
  title.textContent = '데이터 오류';
  const subtitle = document.createElement('span');
  subtitle.textContent = message;
  header.append(title, subtitle);
  errorCard.appendChild(header);
  dashboard.appendChild(errorCard);
}

function clearAutoRefreshTimer() {
  if (autoRefreshTimerId) {
    clearInterval(autoRefreshTimerId);
    autoRefreshTimerId = null;
  }
}

function scheduleAutoRefresh() {
  clearAutoRefreshTimer();
  autoRefreshTimerId = setInterval(() => {
    refreshDashboard(false);
  }, REFRESH_INTERVAL);
}

async function refreshDashboard(showError = false) {
  try {
    const snapshot = await fetchSnapshot();
    renderDashboard(snapshot);
  } catch (error) {
    console.error(error);
    if (showError) {
      renderError(error.message);
    }
  }
}

function handleVisibilityChange() {
  if (document.hidden) {
    clearAutoRefreshTimer();
  } else {
    scheduleAutoRefresh();
    refreshDashboard(false);
  }
}

async function init() {
  await refreshDashboard(true);
  scheduleAutoRefresh();
  document.addEventListener('visibilitychange', handleVisibilityChange);
}

document.addEventListener('DOMContentLoaded', init);

// Menu toggle functionality
const menuToggle = document.getElementById('menu-toggle');
const menuNav = document.getElementById('menu-nav');

if (menuToggle && menuNav) {
  menuToggle.addEventListener('click', () => {
    const isOpen = menuToggle.classList.toggle('open');
    menuNav.classList.toggle('open');
    menuToggle.setAttribute('aria-expanded', String(isOpen));
  });

  // Close menu when clicking on a link
  const menuLinks = menuNav.querySelectorAll('a');
  menuLinks.forEach((link) => {
    link.addEventListener('click', () => {
      menuToggle.classList.remove('open');
      menuNav.classList.remove('open');
      menuToggle.setAttribute('aria-expanded', 'false');
    });
  });

  // Close menu when clicking outside
  document.addEventListener('click', (event) => {
    const isClickInsideMenu = menuNav.contains(event.target);
    const isClickOnToggle = menuToggle.contains(event.target);

    if (!isClickInsideMenu && !isClickOnToggle && menuNav.classList.contains('open')) {
      menuToggle.classList.remove('open');
      menuNav.classList.remove('open');
      menuToggle.setAttribute('aria-expanded', 'false');
    }
  });
}
