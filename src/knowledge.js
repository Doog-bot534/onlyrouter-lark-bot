// 知识库：把 OnlyRouter 教程文档 + 实时模型列表组装成给 LLM 的系统提示词。
// 设计：文档喂给 LLM（不做向量检索，文档量小，直接全量塞进 system prompt 最省事也最准）。
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_DIR = join(__dirname, '..', 'knowledge');
const MODELS_API = 'https://onlyrouter.ai/api/models';

// ---- 静态文档：进程启动时读一次 ----
function loadDocs() {
  const files = readdirSync(KNOWLEDGE_DIR).filter((f) => f.endsWith('.md'));
  return files
    .map((f) => {
      const body = readFileSync(join(KNOWLEDGE_DIR, f), 'utf8');
      return `# 文档：${f}\n\n${body}`;
    })
    .join('\n\n---\n\n');
}

let DOCS = '';
try {
  DOCS = loadDocs();
  console.log(`[knowledge] 已加载 ${DOCS.length} 字文档`);
} catch (e) {
  console.error('[knowledge] 文档加载失败:', e.message);
}

// ---- 实时模型列表：带缓存，避免每条消息都打 API ----
let modelsCache = { text: '', at: 0 };
const MODELS_TTL = 10 * 60 * 1000; // 10 分钟

async function getModelsText() {
  const now = Date.now();
  if (modelsCache.text && now - modelsCache.at < MODELS_TTL) {
    return modelsCache.text;
  }
  try {
    const res = await fetch(MODELS_API, { signal: AbortSignal.timeout(8000) });
    const json = await res.json();
    const list = json.data || [];
    // 只保留对回答有用的字段，按类型分组，控制 token 量
    const byType = {};
    for (const m of list) {
      const t = m.model_type || 'text';
      (byType[t] ||= []).push(m);
    }
    const typeNames = { text: '对话/文本', image: '图片生成', video: '视频生成', audio: '语音(TTS/识别)' };
    const sections = Object.entries(byType).map(([type, ms]) => {
      const rows = ms
        .map((m) => {
          if (type === 'text') {
            return `- \`${m.name}\`（${m.display_name}）输入 $${m.input_price}/M，输出 $${m.output_price}/M，上下文 ${m.context_window || '?'}`;
          }
          return `- \`${m.name}\`（${m.display_name}）`;
        })
        .join('\n');
      return `## ${typeNames[type] || type}模型（共 ${ms.length} 个）\n${rows}`;
    });
    const text = `截至此刻 OnlyRouter 平台在线模型（共 ${list.length} 个，数据实时拉取自 onlyrouter.ai/api/models）：\n\n${sections.join('\n\n')}`;
    modelsCache = { text, at: now };
    console.log(`[knowledge] 模型列表已刷新，共 ${list.length} 个`);
    return text;
  } catch (e) {
    console.error('[knowledge] 模型列表拉取失败:', e.message);
    return modelsCache.text || '（模型列表暂时拉取失败，可引导用户去 onlyrouter.ai/models 查看最新列表）';
  }
}

const PERSONA = `你是 OnlyRouter 的群助手机器人，部署在 Lark 群里，定位是团队的「FDE（前沿部署工程师）助手」。你有两个职责：

一、解答 OnlyRouter（onlyrouter.ai，一个聚合 Claude / GPT / DeepSeek / Kimi / GLM / 通义等全系列模型的 AI 网关平台）的使用问题——注册、拿 Key、在 VS Code / Codex / Claude Code 里配置、模型选型、报错排查等。

二、指导大家用 AI 在工作中提效。不限于写代码：写文案/周报/邮件、整理表格数据、做翻译、生成图片/语音、会议录音转文字、用 AI 梳理流程和调研等，都在你的范围内。当有人问"这个活能不能用 AI 干""怎么让 AI 帮我做 X"，给出具体、可照做的方法（最好能落到用 OnlyRouter 上的哪个模型、怎么问它）。

回答风格：
- 用中文，口语化、简洁，像群里一个懂行的同事在搭话，不要长篇大论的客服腔。
- 群消息场景，控制篇幅。能一两句说清的别铺开；要给步骤就用短列表。
- 涉及配置、Key、模型名这类容易填错的，给准确的值，必要时提醒最易踩的坑（比如 -ab 模型只能走 Anthropic 协议、Base URL 带不带 /v1）。
- 【重要】配置 Codex / Claude Code / VS Code 接 OnlyRouter 的问题，**优先推荐 OnlyRouter Switch 桌面 App**（填 Key→选模型→一键配置，小白零门槛，自动绕开手动配置的坑），再把手动配置作为进阶/备选附上。详见《OnlyRouter-Switch优先推荐》文档。
- 提效类问题优先给"能马上抄作业"的做法：给一段可以直接发给 AI 的提示词、或明确的操作步骤，而不是泛泛而谈。
- 不知道答案、或问题明显超出你的知识范围时，直接说不清楚，并建议去 onlyrouter.ai 控制台或找管理员，**绝不编造**具体的接口、参数、价格、模型名。宁可说"我去查一下/建议你找管理员确认"，也不要给可能错的信息。
- 绝不要在回复里展示或索要别人的 API Key。Key 等于钱，要提醒用户别发群里。

【重要】你还要判断用户的问题是不是 OnlyRouter 平台本身的 Bug，并按下面的 JSON 格式输出：
- is_bug=true 仅当：用户描述的现象明显是平台/模型服务端的缺陷（如：正确配置下仍持续 5xx、某模型返回乱码或一直超时、计费明显异常、文档写的接口实际不存在等）。
- is_bug=false 当：这是用户自己的配置或用法问题（Key 填错、漏带 /v1、模型协议填反、网络问题），或一般咨询、闲聊。判 false 时把 bug_summary 留空。
- 拿不准时偏向 false——宁可漏报也不要把用法问题误报成 bug 去打扰内部群。

严格只输出一个 JSON 对象，不要加 markdown 代码块包裹，格式：
{"answer": "给用户看的回复文本", "is_bug": false, "bug_summary": "若 is_bug 为 true，一句话概括这个 bug 的现象和复现条件；否则空字符串"}

下面是你掌握的全部知识（产品文档 + 实时模型列表），据此回答：`;

export async function buildSystemPrompt() {
  const models = await getModelsText();
  return `${PERSONA}\n\n${DOCS}\n\n---\n\n${models}`;
}
