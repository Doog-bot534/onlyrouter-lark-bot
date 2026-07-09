// OnlyRouter 助手网页问答站 —— 极简 HTTP 服务（Node 原生，不引框架）。
// 静态托管 public/ + POST /api/chat 走 SSE 流式，复用 src 的问答大脑。
import 'dotenv/config';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';
import { askLLMStream } from '../src/llm.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');
const PORT = process.env.WEB_PORT || 8090;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// 读请求 body（JSON）
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1_000_000) reject(new Error('body too large')); // 1MB 上限
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// 静态文件服务（防目录穿越）
async function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = normalize(join(PUBLIC_DIR, urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const buf = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404).end('Not Found');
  }
}
// POST /api/chat：接收 { messages:[{role,content}...] }，SSE 流式返回答案
async function handleChat(req, res) {
  let messages;
  try {
    const body = JSON.parse(await readBody(req));
    messages = body.messages;
    if (!Array.isArray(messages) || messages.length === 0) throw new Error('empty');
    // 只保留 role+content，防注入多余字段；限制历史长度控制 token
    messages = messages
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-12);
    if (!messages.length) throw new Error('invalid');
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '请求格式错误' }));
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    await askLLMStream(messages, (delta) => send('delta', { text: delta }));
    send('done', {});
  } catch (e) {
    console.error('[web] 生成失败:', e.message);
    let hint = '抱歉，出了点问题，请稍后再试。';
    if (e.message.includes('401')) hint = '服务端 Key 无效，请联系管理员。';
    else if (e.message.includes('未配置')) hint = '服务端还没配置好，请联系管理员。';
    send('error', { message: hint });
  }
  res.end();
}

const server = createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/chat') {
    return handleChat(req, res);
  }
  if (req.method === 'GET') {
    return serveStatic(req, res);
  }
  res.writeHead(405).end('Method Not Allowed');
});

server.listen(PORT, () => {
  console.log(`✅ OnlyRouter 助手网页站已启动：http://localhost:${PORT}`);
});

