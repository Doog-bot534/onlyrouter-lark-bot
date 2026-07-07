// 联网搜索接口（预留）。默认关闭——当前靠 knowledge/ 文档 + 模型训练知识回答已够用。
// 以后若发现"文档答不上来"的冷门问题变多，接一个搜索服务即可：
//   1) 在 .env 配 SEARCH_PROVIDER=tavily 和 TAVILY_API_KEY（或 brave + BRAVE_API_KEY）
//   2) 取消下面对应实现的注释
//   3) llm.js 里在构造问题前调用 maybeSearch(question)，把结果拼进上下文
// 之所以先留接口不实装：避免为低频需求引入额外 key 和依赖，等真有需要 5 分钟就能接上。
const PROVIDER = process.env.SEARCH_PROVIDER || 'none';

export function searchEnabled() {
  return PROVIDER !== 'none';
}

// 返回一段可拼进 LLM 上下文的搜索结果文本；未启用时返回空串。
export async function maybeSearch(query) {
  if (PROVIDER === 'none') return '';

  try {
    if (PROVIDER === 'tavily') return await searchTavily(query);
    if (PROVIDER === 'brave') return await searchBrave(query);
    console.warn(`[search] 未知的 SEARCH_PROVIDER: ${PROVIDER}`);
    return '';
  } catch (e) {
    console.error('[search] 搜索失败，降级为不搜索:', e.message);
    return '';
  }
}

async function searchTavily(query) {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return '';
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: key, query, max_results: 5, search_depth: 'basic' }),
    signal: AbortSignal.timeout(10000),
  });
  const json = await res.json();
  const results = (json.results || [])
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.content}\n来源：${r.url}`)
    .join('\n\n');
  return results ? `以下是联网搜索到的参考信息（可能有噪声，请甄别）：\n\n${results}` : '';
}

async function searchBrave(query) {
  const key = process.env.BRAVE_API_KEY;
  if (!key) return '';
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', '5');
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': key },
    signal: AbortSignal.timeout(10000),
  });
  const json = await res.json();
  const results = (json.web?.results || [])
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.description}\n来源：${r.url}`)
    .join('\n\n');
  return results ? `以下是联网搜索到的参考信息（可能有噪声，请甄别）：\n\n${results}` : '';
}
