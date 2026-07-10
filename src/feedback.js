// 信息反馈：记录每条用户提问，每周定时用 LLM 汇总最近一周提问，发到反馈群，帮助产品迭代。
// 与 bug 上报分开：bug 是即时推群，这里是每周聚合推群（本项目里两者可以是同一个群）。
import { appendFileSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import cron from 'node-cron';
import { chat } from './llm.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const LOG_FILE = join(DATA_DIR, 'questions.jsonl');
const STATE_FILE = join(DATA_DIR, 'digest-state.json');
mkdirSync(DATA_DIR, { recursive: true });

// 周报群：优先用专用 Webhook，没配就回退到统一的 LARK_REPORT_WEBHOOK_URL（bug 和周报同群时只填这一个）
const WEBHOOK_URL = process.env.LARK_FEEDBACK_WEBHOOK_URL || process.env.LARK_REPORT_WEBHOOK_URL;
// 每周何时总结，默认每周一 10:07（cron: 分 时 * * 周几；1=周一）
const DIGEST_CRON = process.env.FEEDBACK_DIGEST_CRON || '7 10 * * 1';

// ---- 记录一条提问（每条消息都记，无论是否 bug）----
export function logQuestion({ question, chatType, chatId, answer, isBug, tenantId }) {
  try {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      tenantId: tenantId || 'official', // 记录来源租户，便于按租户看反馈
      chatType,
      chatId,
      question,
      answerPreview: (answer || '').slice(0, 120),
      isBug: Boolean(isBug),
    });
    appendFileSync(LOG_FILE, line + '\n', 'utf8');
  } catch (e) {
    console.error('[feedback] 记录提问失败:', e.message);
  }
}

// ---- 读取最近 N 天的提问（默认 7 天，用于每周总结）----
function readRecentQuestions(days = 7) {
  if (!existsSync(LOG_FILE)) return [];
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const lines = readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean);
  const out = [];
  for (const l of lines) {
    try {
      const o = JSON.parse(l);
      if (new Date(o.ts).getTime() >= cutoff) out.push(o);
    } catch {
      // 跳过坏行
    }
  }
  return out;
}

// 防重复：记住本周期已汇总过的标记（用当次运行日期做键，避免同一天重复触发）
function alreadyDigested(tag) {
  try {
    if (!existsSync(STATE_FILE)) return false;
    const s = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    return s.lastDigestTag === tag;
  } catch {
    return false;
  }
}
function markDigested(tag) {
  try {
    writeFileSync(STATE_FILE, JSON.stringify({ lastDigestTag: tag }), 'utf8');
  } catch (e) {
    console.error('[feedback] 写汇总状态失败:', e.message);
  }
}
// ---- 生成并发送每周总结 ----
async function runDigest(rangeLabel) {
  const items = readRecentQuestions(7);
  if (items.length === 0) {
    console.log(`[feedback] 最近 7 天无提问，跳过每周总结`);
    return;
  }

  const qList = items
    .map((o, i) => `${i + 1}. ${o.question}${o.isBug ? '（机器人判定为疑似bug）' : ''}`)
    .join('\n');

  const system = `你是产品分析助手。下面是 OnlyRouter Lark 群机器人最近一周收到的用户提问原始列表。请汇总成一份简短的产品反馈周报，用于团队做产品迭代。要求：
1. 归纳「高频问题/主题」——哪些问题被反复问，说明文档或产品可能需要改进。
2. 列出「用户遇到的难点/卡点」。
3. 给出「产品改进建议」1-3 条（如某配置总被问说明流程复杂、某能力常被需要说明可强化）。
4. 简洁，用条目，别超过 500 字。不要逐条复述所有问题。`;
  const user = `统计区间：${rangeLabel}，共 ${items.length} 条提问：\n\n${qList}`;

  let summary;
  try {
    summary = await chat(system, user);
  } catch (e) {
    console.error('[feedback] 生成汇总失败:', e.message);
    summary = `（汇总生成失败：${e.message}）\n\n原始提问 ${items.length} 条：\n${qList}`;
  }

  const bugCount = items.filter((o) => o.isBug).length;
  const text = [
    `📊 OnlyRouter 群助手 · 每周总结（${rangeLabel}）`,
    `本周提问：${items.length} 条${bugCount ? `，其中疑似 bug ${bugCount} 条` : ''}`,
    '',
    summary,
  ].join('\n');

  await sendToFeedbackGroup(text);
  markDigested(rangeLabel);
}

async function sendToFeedbackGroup(text) {
  if (!WEBHOOK_URL) {
    console.log('[feedback] 未配置 LARK_FEEDBACK_WEBHOOK_URL，汇总仅打印到日志：\n' + text);
    return;
  }
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_type: 'text', content: { text } }),
      signal: AbortSignal.timeout(8000),
    });
    const json = await res.json().catch(() => ({}));
    if (json.code && json.code !== 0) console.error('[feedback] 周报发送失败:', JSON.stringify(json));
    else console.log('[feedback] 每周总结已发送到反馈群');
  } catch (e) {
    console.error('[feedback] 周报发送异常:', e.message);
  }
}

// 本周区间标签，如 "2026-07-01 ~ 2026-07-08"
function weekRangeLabel() {
  const fmt = (d) => d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  const now = new Date();
  const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  return `${fmt(from)} ~ ${fmt(now)}`;
}

// ---- 启动定时任务 ----
export function startDigestSchedule() {
  cron.schedule(
    DIGEST_CRON,
    () => {
      const label = weekRangeLabel();
      if (alreadyDigested(label)) {
        console.log(`[feedback] ${label} 已总结过，跳过`);
        return;
      }
      console.log(`[feedback] 触发每周总结：${label}`);
      runDigest(label);
    },
    { timezone: 'Asia/Shanghai' }
  );
  console.log(`[feedback] 每周总结已排程（cron: ${DIGEST_CRON}，时区 Asia/Shanghai）${WEBHOOK_URL ? '' : '，⚠️ 未配置反馈 Webhook，将只打印到日志'}`);
}

// 供手动测试：立即生成本周总结
export async function runDigestNow() {
  return runDigest(weekRangeLabel());
}