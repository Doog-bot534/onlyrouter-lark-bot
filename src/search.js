// 联网搜索接口（预留）。默认关闭——当前靠 knowledge/ 文档 + 模型训练知识回答已够用。
// 以后若发现"文档答不上来"的冷门问题变多，接一个搜索服务即可：
//   1) 在 .env 配 SEARCH_PROVIDER=firecrawl 和 FIRECRAWL_API_KEY（或 tavily / brave）
//   2) llm.js 里已在构造问题前调用 maybeSearch(question)，把结果拼进上下文
// 之所以先留接口不实装：避免为低频需求引入额外 key 和依赖，等真有需要改个 .env 就能接上。
//
// 推荐 firecrawl：每月 1000 免费额度（recurring，约 5000 条搜索结果/月），无需信用卡，
//   且能顺带抓整页 markdown，读文档场景更准。tavily / brave 作为备选。
const PROVIDER = process.env.SEARCH_PROVIDER || 'none';

export function searchEnabled() {
  return PROVIDER !== 'none';
}

// 启发式判断这个问题「值不值得联网」。绝大多数 OnlyRouter 配置/使用/提效问题
// 靠本地文档就能答，不该无条件联网（每次联网最长阻塞数秒，是主要延迟来源）。
// 只有出现「需要外部/最新信息」的信号时才搜。零成本，不额外调 LLM。
const SEARCH_SIGNALS = [
  '最新', '最近', '今天', '现在', '目前', '20', // 年份/时效
  '为什么', '报错', '错误', 'error', 'failed', '失败', '不行', '不能用', '连不上', // 疑难排查
  '对比', '区别', '哪个好', '还是', '相比', // 比较
  '其他工具', '别的', '除了', '业界', '市面', 'competitor', '竞品',
];
function worthSearching(query) {
  const q = (query || '').toLowerCase();
  return SEARCH_SIGNALS.some((s) => q.includes(s.toLowerCase()));
}

// 返回一段可拼进 LLM 上下文的搜索结果文本；未启用或判断不需要时返回空串。
export async function maybeSearch(query) {
  if (PROVIDER === 'none') return '';
  // 启发式挡掉大多数「文档就能答」的问题，避免无谓的联网阻塞
  if (!worthSearching(query)) return '';

  try {
    if (PROVIDER === 'firecrawl') return await searchFirecrawl(query);
    if (PROVIDER === 'tavily') return await searchTavily(query);
    if (PROVIDER === 'brave') return await searchBrave(query);
    console.warn(`[search] 未知的 SEARCH_PROVIDER: ${PROVIDER}`);
    return '';
  } catch (e) {
    console.error('[search] 搜索失败，降级为不搜索:', e.message);
    return '';
  }
}

function formatResults(items) {
  const body = items
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}\n来源：${r.url}`)
    .join('\n\n');
  return body ? `以下是联网搜索到的参考信息（可能有噪声，请甄别）：\n\n${body}` : '';
}

// 取真实 key：过滤掉空值和 .env.example 里的占位符（xxxx），避免拿假 key 空跑一次请求。
function realKey(name) {
  const v = process.env[name];
  if (!v || /x{3,}/i.test(v)) return '';
  return v;
}

// firecrawl：每月 1000 免费额度，搜索 2 credits/10 条结果。v2 端点，结果按 source 分组。
async function searchFirecrawl(query) {
  const key = realKey('FIRECRAWL_API_KEY');
  if (!key) return '';
  const res = await fetch('https://api.firecrawl.dev/v2/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, limit: 5 }),
    signal: AbortSignal.timeout(6000),
  });
  const json = await res.json();
  const web = json.data?.web || [];
  return formatResults(web.map((r) => ({ title: r.title, snippet: r.description, url: r.url })));
}

async function searchTavily(query) {
  const key = realKey('TAVILY_API_KEY');
  if (!key) return '';
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: key, query, max_results: 5, search_depth: 'basic' }),
    signal: AbortSignal.timeout(10000),
  });
  const json = await res.json();
  const results = json.results || [];
  return formatResults(results.map((r) => ({ title: r.title, snippet: r.content, url: r.url })));
}

async function searchBrave(query) {
  const key = realKey('BRAVE_API_KEY');
  if (!key) return '';
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', '5');
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': key },
    signal: AbortSignal.timeout(10000),
  });
  const json = await res.json();
  const results = json.web?.results || [];
  return formatResults(results.map((r) => ({ title: r.title, snippet: r.description, url: r.url })));
}
