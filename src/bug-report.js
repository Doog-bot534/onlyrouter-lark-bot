// Bug 上报：通过 Lark 群自定义机器人 Webhook，把判定为 bug 的问题推到 OnlyRouter 内部群。
// 只有 LLM 判定「确实是产品 bug」（而非用户配错/用法问题）时才会调用，避免轰炸内部群。
// bug 上报群：优先用专用 Webhook，没配就回退到统一的 LARK_REPORT_WEBHOOK_URL（bug 和周报同群时只填这一个）
const WEBHOOK_URL = process.env.LARK_BUG_WEBHOOK_URL || process.env.LARK_REPORT_WEBHOOK_URL;

export function bugReportEnabled() {
  return Boolean(WEBHOOK_URL);
}

export async function reportBug({ summary, question, chatType }) {
  if (!WEBHOOK_URL) return;

  const time = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const text = [
    '🐞 OnlyRouter 疑似 Bug 上报',
    `时间：${time}`,
    `来源：Lark ${chatType === 'group' ? '群聊' : '单聊'}`,
    '',
    `用户原话：${question}`,
    '',
    `机器人判断：${summary}`,
  ].join('\n');

  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'text', content: { text } }),
      signal: AbortSignal.timeout(8000),
    });
    const json = await res.json().catch(() => ({}));
    // Lark 自定义机器人成功返回 {code:0} 或 {StatusCode:0}
    if (json.code && json.code !== 0) {
      console.error('[bug] 上报失败:', JSON.stringify(json));
    } else {
      console.log('[bug] 已上报到 OnlyRouter 群');
    }
  } catch (e) {
    console.error('[bug] 上报异常:', e.message);
  }
}
