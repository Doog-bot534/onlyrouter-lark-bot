// 信息反馈：记录每条用户提问，每天定时用 LLM 汇总当天提问，发到产品反馈群，帮助产品迭代。
// 与 bug 上报分开：bug 是即时推到开发群，这里是每日聚合推到产品反馈群。
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

const WEBHOOK_URL = process.env.LARK_FEEDBACK_WEBHOOK_URL;
// 每天几点汇总，默认 18:00（cron: 分 时 * * *）
const DIGEST_CRON = process.env.FEEDBACK_DIGEST_CRON || '3 18 * * *';

// ---- 记录一条提问（每条消息都记，无论是否 bug）----
export function logQuestion({ question, chatType, chatId, answer, isBug }) {
  try {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
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

// ---- 读取某天的提问 ----
function readQuestionsOfDay(dayStr) {
  if (!existsSync(LOG_FILE)) return [];
  const lines = readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean);
  const out = [];
  for (const l of lines) {
    try {
      const o = JSON.parse(l);
      if (o.ts.slice(0, 10) === dayStr) out.push(o);
    } catch {
      // 跳过坏行
    }
  }
  return out;
}

// 防重复：记住已汇总过的日期
function alreadyDigested(dayStr) {
  try {
    if (!existsSync(STATE_FILE)) return false;
    const s = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    return s.lastDigestDay === dayStr;
  } catch {
    return false;
  }
}
function markDigested(dayStr) {
  try {
    writeFileSync(STATE_FILE, JSON.stringify({ lastDigestDay: dayStr }), 'utf8');
  } catch (e) {
    console.error('[feedback] 写汇总状态失败:', e.message);
  }
}
// ---- 生成并发送当天汇总 ----
async function runDigest(dayStr) {
  const items = readQuestionsOfDay(dayStr);
  if (items.length === 0) {
    console.log(`[feedback] ${dayStr} 无提问，跳过汇总`);
    return;
  }

  const qList = items
    .map((o, i) => `${i + 1}. ${o.question}${o.isBug ? '（机器人判定为疑似bug）' : ''}`)
    .join('\n');

  const system = `你是产品分析助手。下面是 OnlyRouter Lark 群机器人今天收到的用户提问原始列表。请汇总成一份简短的产品反馈日报，用于团队做产品迭代。要求：
1. 归纳「高频问题/主题」——哪些问题被反复问，说明文档或产品可能需要改进。
2. 列出「用户遇到的难点/卡点」。
3. 给出「产品改进建议」1-3 条（如某配置总被问说明流程复杂、某能力常被需要说明可强化）。
4. 简洁，用条目，别超过 400 字。不要逐条复述所有问题。`;
  const user = `日期：${dayStr}，共 ${items.length} 条提问：\n\n${qList}`;

  let summary;
  try {
    summary = await chat(system, user);
  } catch (e) {
    console.error('[feedback] 生成汇总失败:', e.message);
    summary = `（汇总生成失败：${e.message}）\n\n原始提问 ${items.length} 条：\n${qList}`;
  }

  const bugCount = items.filter((o) => o.isBug).length;
  const text = [
    `📊 OnlyRouter 群助手 · 每日反馈（${dayStr}）`,
    `提问总数：${items.length} 条${bugCount ? `，其中疑似 bug ${bugCount} 条` : ''}`,
    '',
    summary,
  ].join('\n');

  await sendToFeedbackGroup(text);
  markDigested(dayStr);
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
    if (json.code && json.code !== 0) console.error('[feedback] 汇总发送失败:', JSON.stringify(json));
    else console.log('[feedback] 每日汇总已发送到产品反馈群');
  } catch (e) {
    console.error('[feedback] 汇总发送异常:', e.message);
  }
}

// 昨天的日期字符串（汇总在次日凌晨或当天晚上跑，这里汇总「当天」）
function todayStr() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }); // YYYY-MM-DD
}

// ---- 启动定时任务 ----
export function startDigestSchedule() {
  cron.schedule(
    DIGEST_CRON,
    () => {
      const day = todayStr();
      if (alreadyDigested(day)) {
        console.log(`[feedback] ${day} 已汇总过，跳过`);
        return;
      }
      console.log(`[feedback] 触发每日汇总：${day}`);
      runDigest(day);
    },
    { timezone: 'Asia/Shanghai' }
  );
  console.log(`[feedback] 每日汇总已排程（cron: ${DIGEST_CRON}，时区 Asia/Shanghai）${WEBHOOK_URL ? '' : '，⚠️ 未配置反馈 Webhook，将只打印到日志'}`);
}

// 供手动测试：立即汇总指定日期（默认今天）
export async function runDigestNow(day) {
  return runDigest(day || todayStr());
}