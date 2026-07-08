// 自我蒸馏迭代：每次问答后，让 LLM 反思本次回答质量，把可复用的经验/教训沉淀成简短笔记，
// 写进 learnings.md。这些经验会拼进后续的系统提示词，形成「越答越准」的闭环。
//
// 设计约束（避免翻车）：
//   - 异步做，不拖慢用户回复
//   - 经验库有条数上限，超了丢最旧的，防止撑爆 context
//   - 只沉淀「可复用的规律」（如某类问题常踩的坑），不记流水账
//   - 判定「本次无新经验」时不写，保持精炼
import { appendFileSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chat } from './llm.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const LEARN_FILE = join(DATA_DIR, 'learnings.md');
mkdirSync(DATA_DIR, { recursive: true });

const MAX_LEARNINGS = 40; // 经验条数上限，控制 token
const MIN_INTERVAL_MS = 0; // 预留：如需限流反思频率可调

// 读现有经验（拼进 system prompt 用）
export function loadLearnings() {
  if (!existsSync(LEARN_FILE)) return '';
  const body = readFileSync(LEARN_FILE, 'utf8').trim();
  return body;
}

// 取现有经验的条目数组（每条以 "- " 开头）
function readItems() {
  if (!existsSync(LEARN_FILE)) return [];
  return readFileSync(LEARN_FILE, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '));
}

function saveItems(items) {
  const capped = items.slice(-MAX_LEARNINGS);
  const header = '# 机器人自我沉淀的经验（自动维护，越答越准）\n\n';
  writeFileSync(LEARN_FILE, header + capped.join('\n') + '\n', 'utf8');
}
// 反思一次问答，若有可复用经验则沉淀。异步调用，失败不影响主流程。
export async function reflect({ question, answer, isBug }) {
  try {
    const existing = readItems();
    const existingText = existing.length
      ? existing.join('\n')
      : '（暂无）';

    const system = `你是 OnlyRouter 群助手机器人的"自我教练"。机器人刚回答了一个用户问题，你要复盘这次问答，判断有没有值得沉淀的、【可复用】的经验，让它以后回答同类问题更好。

已有的经验笔记：
${existingText}

规则：
- 只沉淀能改进【未来同类回答】的规律或教训，例如：某类问题用户常有的误解、某个高频追问点、回答里容易漏掉的关键提醒、更好的表达方式。
- 如果这次问答很普通、或经验已被已有笔记覆盖，就【不要】产出新经验。
- 产出的经验要具体、精炼，一条一句话，能直接指导回答。不要泛泛而谈（如"要更耐心"这种没用）。
- 绝不沉淀用户的隐私、Key、具体个人信息。

只输出 JSON，格式：{"has_insight": true/false, "insight": "一句话经验，has_insight 为 false 时留空"}`;

    const user = `用户问题：${question}\n\n机器人的回答：${answer}\n\n${isBug ? '（这条被判定为疑似 bug）' : ''}`;

    const raw = await chat(system, user);
    const parsed = parseInsight(raw);
    if (parsed.hasInsight && parsed.insight) {
      const items = readItems();
      // 去重：完全相同的不重复加
      if (!items.some((it) => it.slice(2).trim() === parsed.insight)) {
        items.push(`- ${parsed.insight}`);
        saveItems(items);
        console.log(`[distill] 沉淀新经验：${parsed.insight}`);
      }
    }
  } catch (e) {
    console.error('[distill] 反思失败（不影响回复）:', e.message);
  }
}

function parseInsight(raw) {
  let s = raw.trim();
  if (s.startsWith('```')) {
    const m = s.match(/^```(?:json)?\s*([\s\S]*?)```$/);
    if (m) s = m[1].trim();
  }
  try {
    const o = JSON.parse(s);
    return { hasInsight: o.has_insight === true, insight: (o.insight || '').trim() };
  } catch {
    return { hasInsight: false, insight: '' };
  }
}
