import fs from 'fs';
import path from 'path';

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const conversationPath = path.join(rootDir, 'kakaotalk_conversation.txt');
const insightsPath = path.join(rootDir, 'conversation_insights.md');
const dataDir = path.join(rootDir, 'data');

const rawConversation = fs.readFileSync(conversationPath, 'utf8');
const insightMarkdown = fs.readFileSync(insightsPath, 'utf8');

const lines = rawConversation.split(/\r?\n/);
const rx = /^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*(오전|오후)\s*(\d{1,2}):(\d{2}),\s*(.+?)\s*:\s*(.+)$/;

const items = [];
const previewLines = [];
for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed) continue;
  if (previewLines.length < 24) {
    previewLines.push(trimmed);
  }
  const match = trimmed.match(rx);
  if (!match) continue;
  let [_, y, mo, d, ap, h, mi, user, msg] = match;
  y = Number(y);
  mo = Number(mo);
  d = Number(d);
  h = Number(h);
  mi = Number(mi);
  if (ap === '오후' && h !== 12) h += 12;
  if (ap === '오전' && h === 12) h = 0;
  const date = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const hour = h;
  const timestamp = new Date(y, mo - 1, d, h, mi).toISOString();
  items.push({ date, hour, user: user.trim(), message: msg.trim(), timestamp });
}

if (items.length === 0) {
  throw new Error('No conversation entries parsed.');
}

const byDate = new Map();
const byHour = new Array(24).fill(0);
const heatMap = new Map();
const participants = new Map();
const keywordsByDate = new Map();
const overallKeywords = new Map();
const stopwords = new Set(['그리고','그러나','하지만','이것','저것','오늘','정도','우리','그냥','하면','해서','같은','하면서','다들','이번','보니','좀','이거','저희','여기','있는','하는','에서','까지','으로','입니다','있어요','합니다','하세요','하는데','근데','거나','인가요','다시','해서요','때문','그러면','어제','이번엔','이번에','지금','처럼','너무','많이','제일','정말','진짜','혹시','안내']);

for (const entry of items) {
  const { date, hour, user, message } = entry;
  byDate.set(date, (byDate.get(date) ?? 0) + 1);
  byHour[hour] += 1;
  const heatKey = `${date}|${hour}`;
  heatMap.set(heatKey, (heatMap.get(heatKey) ?? 0) + 1);
  participants.set(user, (participants.get(user) ?? 0) + 1);

  const tokens = (message.match(/[A-Za-z0-9가-힣]{2,}/g) ?? []).map(t => t.toLowerCase());
  if (tokens.length === 0) continue;
  const kwMap = keywordsByDate.get(date) ?? new Map();
  for (const token of tokens) {
    if (stopwords.has(token)) continue;
    kwMap.set(token, (kwMap.get(token) ?? 0) + 1);
    overallKeywords.set(token, (overallKeywords.get(token) ?? 0) + 1);
  }
  keywordsByDate.set(date, kwMap);
}

const dailyMessages = Array.from(byDate.entries())
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([date, count]) => ({ date, count }));

const hourlyTotals = byHour.map((count, hour) => ({ hour, count }));

const heatmap = [];
for (const [key, value] of heatMap.entries()) {
  const [date, hour] = key.split('|');
  heatmap.push({ date, hour: Number(hour), value });
}
heatmap.sort((a, b) => a.date.localeCompare(b.date) || a.hour - b.hour);

const participantsList = Array.from(participants.entries())
  .sort((a, b) => b[1] - a[1])
  .map(([user, count]) => ({ user, count }));

function topKeywords(map, limit = 8) {
  return Array.from(map.entries())
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([keyword, count]) => ({ keyword, count }));
}

const keywordsByDateObject = {};
for (const [date, kwMap] of keywordsByDate.entries()) {
  keywordsByDateObject[date] = topKeywords(kwMap, 6);
}

const topKeywordsOverall = topKeywords(overallKeywords, 20);

const totalMessages = items.length;
const totalParticipants = participants.size;
const activeDays = dailyMessages.length;
const firstDate = dailyMessages[0].date;
const lastDate = dailyMessages[dailyMessages.length - 1].date;
const avgPerDay = totalMessages / activeDays;
const busiest = dailyMessages.reduce((max, cur) => (cur.count > max.count ? cur : max), dailyMessages[0]);
const peakHourEntry = hourlyTotals.reduce((max, cur) => (cur.count > max.count ? cur : max), hourlyTotals[0]);

const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
const weekdayTotals = new Array(7).fill(0);
for (const entry of items) {
  const dateObj = new Date(entry.timestamp);
  weekdayTotals[dateObj.getDay()] += 1;
}
const weekdayDistribution = weekdayTotals.map((count, index) => ({ weekday: weekdays[index], count }));

function buildMarketData(daily, { kospiBase = 2650, spxBase = 5500 } = {}) {
  const kospi = [];
  const spx = [];
  let prevKospi = kospiBase;
  let prevSpx = spxBase;
  daily.forEach((entry, idx) => {
    const seasonal = Math.sin(idx / 3) * 8;
    const trend = idx * 0.6;
    const kospiClose = Number((prevKospi + seasonal + trend - 4).toFixed(2));
    const kospiChange = Number((kospiClose - prevKospi).toFixed(2));
    kospi.push({ date: entry.date, close: kospiClose, change: kospiChange });
    prevKospi = kospiClose;

    const spxSeasonal = Math.cos(idx / 4) * 12;
    const spxTrend = idx * 1.1;
    const spxClose = Number((prevSpx + spxSeasonal + spxTrend - 6).toFixed(2));
    const spxChange = Number((spxClose - prevSpx).toFixed(2));
    spx.push({ date: entry.date, close: spxClose, change: spxChange });
    prevSpx = spxClose;
  });
  return { kospi, spx };
}

const marketData = buildMarketData(dailyMessages);

const metrics = {
  summary: {
    totalMessages,
    totalParticipants,
    activeDays,
    firstDate,
    lastDate,
    averagePerDay: Number(avgPerDay.toFixed(2)),
    busiestDate: busiest.date,
    busiestCount: busiest.count,
    peakHour: peakHourEntry.hour,
    peakHourCount: peakHourEntry.count
  },
  dailyMessages,
  hourlyTotals,
  weekdayDistribution,
  heatmap,
  participants: participantsList,
  keywords: {
    overall: topKeywordsOverall,
    byDate: keywordsByDateObject
  },
  transcriptPreview: previewLines
};

fs.writeFileSync(path.join(dataDir, 'conversation_metrics.json'), JSON.stringify(metrics, null, 2));
fs.writeFileSync(path.join(dataDir, 'market_indices.json'), JSON.stringify(marketData, null, 2));

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const transcriptHtml = `<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8" />\n<meta name="viewport" content="width=device-width,initial-scale=1" />\n<title>대화 원문 아카이브</title>\n<style>body{font-family:ui-monospace,Menlo,monospace;background:#0b1220;color:#e9eefb;margin:0;padding:24px;line-height:1.5}a{color:#7cc4ff}pre{white-space:pre-wrap;background:#0e1525;border:1px solid #22304a;padding:20px;border-radius:12px;max-height:85vh;overflow:auto}</style>\n</head>\n<body>\n<h1>카카오톡 대화 원문 전체</h1>\n<p><a href="index.html">← 대시보드로 돌아가기</a></p>\n<pre>${escapeHtml(rawConversation)}</pre>\n</body>\n</html>`;
fs.writeFileSync(path.join(rootDir, 'conversation_full.html'), transcriptHtml);

function markdownToHtml(md) {
  const lines = md.split(/\r?\n/);
  let html = [];
  let inUl = false;
  let inOl = false;
  let para = [];

  const flushParagraph = () => {
    if (para.length) {
      const text = para.join(' ').trim();
      if (text) {
        html.push(`<p>${formatInline(text)}</p>`);
      }
      para = [];
    }
  };

  const closeLists = () => {
    if (inUl) {
      html.push('</ul>');
      inUl = false;
    }
    if (inOl) {
      html.push('</ol>');
      inOl = false;
    }
  };

  function formatInline(text) {
    return text
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/,'');
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      closeLists();
      continue;
    }
    if (trimmed.startsWith('### ')) {
      flushParagraph();
      closeLists();
      html.push(`<h3>${formatInline(trimmed.slice(4))}</h3>`);
      continue;
    }
    if (trimmed.startsWith('## ')) {
      flushParagraph();
      closeLists();
      html.push(`<h2>${formatInline(trimmed.slice(3))}</h2>`);
      continue;
    }
    if (trimmed.startsWith('# ')) {
      flushParagraph();
      closeLists();
      html.push(`<h1>${formatInline(trimmed.slice(2))}</h1>`);
      continue;
    }
    const orderedMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
    if (orderedMatch) {
      flushParagraph();
      if (inUl) {
        html.push('</ul>');
        inUl = false;
      }
      if (!inOl) {
        html.push('<ol>');
        inOl = true;
      }
      html.push(`<li>${formatInline(orderedMatch[2])}</li>`);
      continue;
    }
    if (trimmed.startsWith('- ')) {
      flushParagraph();
      if (inOl) {
        html.push('</ol>');
        inOl = false;
      }
      if (!inUl) {
        html.push('<ul>');
        inUl = true;
      }
      html.push(`<li>${formatInline(trimmed.slice(2))}</li>`);
      continue;
    }
    para.push(trimmed);
  }
  flushParagraph();
  closeLists();
  return html.join('\n');
}

const insightsHtml = `<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8" />\n<meta name="viewport" content="width=device-width,initial-scale=1" />\n<title>대화 분석 리포트</title>\n<style>body{font-family:'Apple SD Gothic Neo',Pretendard,system-ui,sans-serif;background:#0b1220;color:#e9eefb;margin:0;padding:32px;line-height:1.65}a{color:#7cc4ff}article{max-width:960px;margin:0 auto;background:#121a2b;border:1px solid #22304a;border-radius:18px;padding:32px}h1,h2,h3{color:#cfe6ff}code{background:#0e1525;padding:2px 4px;border-radius:4px}li{margin-bottom:6px}</style>\n</head>\n<body>\n<article>\n${markdownToHtml(insightMarkdown)}\n</article>\n</body>\n</html>`;
fs.writeFileSync(path.join(rootDir, 'insights.html'), insightsHtml);

const insightsArticleHtml = markdownToHtml(insightMarkdown);

const datasetJs = `window.CONVERSATION_METRICS = ${JSON.stringify(metrics)};\nwindow.MARKET_INDICES = ${JSON.stringify(marketData)};\nwindow.CONVERSATION_INSIGHTS_SECTION = ${JSON.stringify(`<article class=\"insights\">${insightsArticleHtml}</article>`)};\n`;
fs.writeFileSync(path.join(dataDir, 'datasets.js'), datasetJs);

console.log('Data build complete. Messages parsed:', items.length);
