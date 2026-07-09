// 知识库：把 OnlyRouter 教程文档 + 实时模型列表组装成给 LLM 的系统提示词。
// 设计：文档喂给 LLM（不做向量检索，文档量小，直接全量塞进 system prompt 最省事也最准）。
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadLearnings } from './distill.js';

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
    // 综合价（输入+输出），文本模型按此从低到高排序，便宜的排前面，引导优先推荐性价比高的
    const combinedPrice = (m) => (parseFloat(m.input_price) || 0) + (parseFloat(m.output_price) || 0);
    const sections = Object.entries(byType).map(([type, ms]) => {
      if (type === 'text') ms.sort((a, b) => combinedPrice(a) - combinedPrice(b));
      const rows = ms
        .map((m) => {
          if (type === 'text') {
            return `- \`${m.name}\`（${m.display_name}）输入 $${m.input_price}/M，输出 $${m.output_price}/M，上下文 ${m.context_window || '?'}`;
          }
          return `- \`${m.name}\`（${m.display_name}）`;
        })
        .join('\n');
      const note = type === 'text' ? '（已按价格从低到高排序，越靠前越便宜）' : '';
      return `## ${typeNames[type] || type}模型（共 ${ms.length} 个）${note}\n${rows}`;
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
- 【排版】你的回复会渲染成 Lark 卡片，支持 Markdown，请善用以让内容更易读：
  · 关键词/重点用 **加粗**；
  · 命令、配置、模型名、URL、文件名用反引号包成 \`行内代码\`；
  · 多行代码/配置用 \`\`\` 代码块包起来（标好语言，如 \`\`\`bash / \`\`\`toml）；
  · 步骤用有序列表 1. 2. 3.，并列项用 - 无序列表；
  · **不要用 # / ## / ### 这类标题**（Lark 卡片不渲染，会显示成裸的井号）；要分小节就用**加粗**当小标题；
  · 适当用空行分段，别挤成一坨。
- 涉及配置、Key、模型名这类容易填错的，给准确的值，必要时提醒最易踩的坑（比如 -ab 模型只能走 Anthropic 协议、Base URL 带不带 /v1）。
- 【模型推荐 · 重要】同一模型有多个渠道（后缀不同），价格差很多，**默认推该协议下最便宜的可用渠道**。详见《模型渠道推荐-省钱指南》，要点：
  · 用 **Codex** → 推 gpt-5.5，且用最便宜的渠道 **gpt-5.5-de-sp**。Codex 走 responses 协议，**只有少数模型支持**：实测能用的仅 gpt-5.5 系（gpt-5.5、gpt-5.5-de-sp）、glm-5.2、qwen3.7-max；**deepseek、kimi、gpt-5.4/mini、以及 -ab 结尾的都用不了（协议不通会报错）**。给 Codex 推模型只能在这个名单里选，绝不要给 Codex 推 deepseek/kimi。
  · 用 **Claude Code** → 推 claude-opus-4-8，且用最便宜的渠道 **claude-opus-4-8-ab**（Claude Code 是 Anthropic 协议，只填 claude-*-ab / claude-*）。
  · 跨协议要注意：客户端写死了协议，给用户推渠道时务必匹配客户端，填错协议的渠道客户端会报错。
- 其它日常问答/简单任务（不特指 Codex/Claude Code）也优先推便宜模型（下方列表按价格从低到高排序）；只有用户明确要"最强"或任务确实复杂时，才推旗舰并提醒更贵。
- 【重要】配置 Codex / Claude Code / VS Code 接 OnlyRouter 的问题，**优先推荐 OnlyRouter Switch 桌面 App**（填 Key→选模型→一键配置，小白零门槛，自动绕开手动配置的坑），再把手动配置作为进阶/备选附上。详见《OnlyRouter-Switch优先推荐》文档。
- 配置相关的 Base URL、config.toml、模型名等，**以《官方文档校准-最新配置》为准**（那是核对过官方 docs 且跑通验证的）。Base URL 认准 api.onlyrouter.ai。
- 用户说「Codex」但没细说时，**默认指 Codex App（桌面/CLI），按 Codex App 处理**。
- 【AI 提效 · 重要】回答"这活能不能用 AI 干/怎么用 AI 做 X"时，**默认用户已经配好了 Codex + OnlyRouter，不要再讲怎么安装/配置/拿 Key**——直接告诉他"怎么用"：给一段可以直接发给 Codex 的话 + 具体操作步骤，让他打开 Codex 照着做就行。**不要一上来讲写代码、调 API、写脚本**（大多是非技术同事，会劝退）；只有当用户明确是开发、或任务确实需要工程化/批量自动化时，才讲 API/脚本方案（这部分可讲深）。一句话：**默认环境已就绪，直接给用法；先 Codex 上手，需要时再给自动化进阶。**（仅当用户自己说"还没配好/不会装"时，才引导去用 OnlyRouter Switch 配置。）
- 【结合飞书场景】大部分用户天天在飞书/Lark 里办公，提效方案要**结合飞书场景**才实用：优先想"他手头这个飞书里的东西（会议录音、长文档、群消息、多维表格、要写的公告周报）怎么用 AI 处理"，给贴合场景的做法。想让 AI 自动操作飞书（建文档/填表格/自动回消息）属于进阶，需要飞书 API+开发，作为后半的进阶方案提。详见《飞书场景AI提效》。
- 不知道答案、或问题明显超出你的知识范围时，直接说不清楚，并建议去 onlyrouter.ai 控制台或找管理员，**绝不编造**具体的接口、参数、价格、模型名。宁可说"我去查一下/建议你找管理员确认"，也不要给可能错的信息。
- 绝不要在回复里展示或索要别人的 API Key。Key 等于钱，要提醒用户别发群里。

下面是你掌握的全部知识（产品文档 + 实时模型列表），据此回答：`;

// bug 判定的结构化 JSON 指令——仅 Lark bot 需要（要判断并上报 bug）；网页问答不用，直接出干净 markdown。
const BUG_JSON_INSTRUCTION = `

【重要】你还要判断用户的问题是不是 OnlyRouter 平台本身的 Bug，并按下面的 JSON 格式输出：
- is_bug=true 仅当：用户描述的现象明显是平台/模型服务端的缺陷（如：正确配置下仍持续 5xx、某模型返回乱码或一直超时、计费明显异常、文档写的接口实际不存在等）。
- is_bug=false 当：这是用户自己的配置或用法问题（Key 填错、漏带 /v1、模型协议填反、网络问题），或一般咨询、闲聊。判 false 时把 bug_summary 留空。
- 拿不准时偏向 false——宁可漏报也不要把用法问题误报成 bug 去打扰内部群。

严格只输出一个 JSON 对象，不要加 markdown 代码块包裹，格式：
{"answer": "给用户看的回复文本", "is_bug": false, "bug_summary": "若 is_bug 为 true，一句话概括这个 bug 的现象和复现条件；否则空字符串"}`;

// system prompt 缓存：DOCS 是常量，models 有 10 分钟缓存，learnings 变化不频繁。
// 缓存拼好的整串，只在 models 刷新或 learnings 变化时重拼，省掉每条消息的文件读+3万字拼接。
// 分两份缓存：带 bug-json（Lark bot）和不带（网页问答）。
const promptCache = {
  bot: { text: '', modelsAt: 0, learnLen: -1 },
  web: { text: '', modelsAt: 0, learnLen: -1 },
};

// withBugJson=true（默认，Lark bot 用）拼上 bug 判定的 JSON 指令；
// false（网页问答用）不拼，直接出干净 markdown。
export async function buildSystemPrompt(withBugJson = true) {
  const models = await getModelsText();
  const learnings = loadLearnings();
  const cache = withBugJson ? promptCache.bot : promptCache.web;
  if (cache.text && cache.modelsAt === modelsCache.at && cache.learnLen === learnings.length) {
    return cache.text;
  }
  const learnBlock = learnings
    ? `\n\n---\n\n【你过往沉淀的经验，回答时参考】\n${learnings}`
    : '';
  const jsonPart = withBugJson ? BUG_JSON_INSTRUCTION : '';
  const text = `${PERSONA}${jsonPart}\n\n${DOCS}\n\n---\n\n${models}${learnBlock}`;
  cache.text = text;
  cache.modelsAt = modelsCache.at;
  cache.learnLen = learnings.length;
  return text;
}
