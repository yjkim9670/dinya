const DATA_URL = 'data/latest.json';
const dashboard = document.getElementById('dashboard');
const lastUpdated = document.getElementById('last-updated');

const priceFormatters = new Map();
const numberFormatter = new Intl.NumberFormat('ko-KR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const percentFormatter = new Intl.NumberFormat('ko-KR', {
  style: 'percent',
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

const SIGNAL_LABELS = {
  trend: '추세',
  momentum: '모멘텀',
};

const SIGNAL_DESCRIPTIONS = {
  trend: {
    bullish: '상승 추세 (단기 > 중기)',
    bearish: '하락 추세 (단기 < 중기)',
    neutral: '추세 중립',
  },
  momentum: {
    overbought: '과열 구간 (RSI ≥ 70)',
    oversold: '침체 구간 (RSI ≤ 30)',
    neutral: '모멘텀 중립',
  },
};

const SIGNAL_STYLES = {
  bullish: 'positive',
  oversold: 'positive',
  bearish: 'negative',
  overbought: 'negative',
};

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
  const canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `${ticker.name} 가격 차트`);
  chartContainer.appendChild(canvas);

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
        latest?.close != null
          ? priceFormatter.format(latest.close)
          : '데이터 없음',
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
      label: 'SMA 5',
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
      label: 'RSI 14',
      value:
        ticker.indicators?.rsi14 != null
          ? numberFormatter.format(ticker.indicators.rsi14)
          : '계산 불가',
      className:
        ticker.indicators?.rsi14 != null
          ? ticker.indicators.rsi14 >= 70
            ? 'negative'
            : ticker.indicators.rsi14 <= 30
            ? 'positive'
            : undefined
          : undefined,
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

  const signalsSection = document.createElement('div');
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

  if (Array.isArray(ticker.news) && ticker.news.length > 0) {
    ticker.news.forEach((item) => {
      const li = document.createElement('li');
      const link = document.createElement('a');
      link.href = item.link;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.innerHTML = `
        <strong>${item.title}</strong>
        <span>${item.publisher ?? '출처 미상'} · ${formatRelativeTime(item.published_at)}</span>
      `;
      li.appendChild(link);
      newsList.appendChild(li);
    });
  } else {
    const li = document.createElement('li');
    li.innerHTML = '<span>표시할 뉴스가 없습니다.</span>';
    newsList.appendChild(li);
  }

  newsSection.appendChild(newsList);

  card.append(header, chartContainer, meta, signalsSection, newsSection);

  requestAnimationFrame(() => {
    renderChart(canvas, ticker);
  });

  return card;
}

function renderChart(canvas, ticker) {
  const history = Array.isArray(ticker.history) ? ticker.history : [];
  const labels = history.map((entry) => new Date(entry.timestamp));
  const data = history.map((entry) => entry.close);

  new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: '종가',
          data,
          fill: false,
          borderColor: '#22d3ee',
          backgroundColor: 'rgba(34, 211, 238, 0.2)',
          tension: 0.35,
          borderWidth: 2,
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          type: 'time',
          ticks: {
            color: 'rgba(226, 232, 240, 0.65)',
          },
          time: {
            tooltipFormat: 'yyyy-MM-dd HH:mm',
          },
          grid: {
            color: 'rgba(148, 163, 184, 0.12)',
          },
        },
        y: {
          ticks: {
            color: 'rgba(226, 232, 240, 0.65)',
            callback(value) {
              const formatter = ensurePriceFormatter(ticker.currency || 'KRW');
              return formatter.format(value);
            },
          },
          grid: {
            color: 'rgba(148, 163, 184, 0.12)',
          },
        },
      },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          callbacks: {
            label(context) {
              const formatter = ensurePriceFormatter(ticker.currency || 'KRW');
              return `종가: ${formatter.format(context.parsed.y)}`;
            },
          },
        },
      },
    },
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

function renderDashboard(snapshot) {
  dashboard.innerHTML = '';

  snapshot.tickers?.forEach((ticker) => {
    dashboard.appendChild(createCard(ticker));
  });

  if (snapshot.generated_at) {
    const generated = new Date(snapshot.generated_at);
    if (!Number.isNaN(generated.getTime())) {
      lastUpdated.textContent = generated.toLocaleString('ko-KR');
    }
  }
}

function renderError(message) {
  dashboard.innerHTML = '';
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

async function init() {
  try {
    const snapshot = await fetchSnapshot();
    renderDashboard(snapshot);
  } catch (error) {
    console.error(error);
    renderError(error.message);
  }
}

document.addEventListener('DOMContentLoaded', init);
