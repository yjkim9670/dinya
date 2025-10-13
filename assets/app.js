const DATA_URL = 'data/latest.json';
const REFRESH_INTERVAL = 5 * 60 * 1000;

const dashboard = document.getElementById('dashboard');
const categoryNav = document.getElementById('category-nav');
const lastUpdated = document.getElementById('last-updated');

const DEFAULT_CHART_DAYS = 20;
const MAX_CHART_DAYS = 60;
const CHART_RANGE_STEP = 1;

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

  card.append(header, chartContainer, meta, indicatorSection, signalsSection, newsSection);

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

  const chart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: '종가',
          data,
          fill: false,
          borderColor: '#8ba4ff',
          backgroundColor: 'rgba(139, 164, 255, 0.18)',
          tension: 0.35,
          borderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 6,
          pointHitRadius: 12,
        },
      ],
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
            color: 'rgba(235, 239, 245, 0.7)',
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 6,
          },
          time: {
            tooltipFormat: 'yyyy-MM-dd',
            unit: 'day',
          },
          grid: {
            color: 'rgba(255, 255, 255, 0.08)',
          },
        },
        y: {
          ticks: {
            color: 'rgba(235, 239, 245, 0.7)',
            callback(value) {
              return priceFormatter.format(value);
            },
          },
          grid: {
            color: 'rgba(255, 255, 255, 0.05)',
          },
        },
      },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          displayColors: false,
          callbacks: {
            title(context) {
              const entry = limitedHistory[context[0]?.dataIndex];
              if (!entry) return '';
              const parsedDate = new Date(entry.timestamp);
              return Number.isNaN(parsedDate.getTime()) ? '' : dateLabelFormatter.format(parsedDate);
            },
            label(context) {
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

function renderDashboard(snapshot) {
  const { grouped, uncategorized } = groupTickers(snapshot.tickers);

  const knownSymbols = new Set((snapshot.tickers ?? []).map((item) => item.symbol));
  chartRangeSelections.forEach((_, symbol) => {
    if (!knownSymbols.has(symbol)) {
      chartRangeSelections.delete(symbol);
    }
  });

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
