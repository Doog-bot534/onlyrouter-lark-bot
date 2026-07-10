// OnlyRouter Lark 机器人入口（bot 容器：只跑官方自有 bot）。
// 客户托管 bot 由 web 容器（web/server.js）统一 loadAll 拉起，避免两个容器
// 都拉起同一租户导致长连接抢消息。
import 'dotenv/config';
import { createTenantBot } from './bot-factory.js';
import { startDigestSchedule } from './feedback.js';

const { LARK_APP_ID, LARK_APP_SECRET } = process.env;

if (LARK_APP_ID && LARK_APP_SECRET) {
  const official = createTenantBot({
    appId: LARK_APP_ID,
    appSecret: LARK_APP_SECRET,
    domain: process.env.LARK_DOMAIN,
    tenantId: 'official',
    label: 'OnlyRouter官方',
  });
  official.start();
  console.log('✅ 官方 bot 已启动');
} else {
  console.log('ℹ️ 未配置官方 bot 凭证，退出');
  process.exit(0);
}

startDigestSchedule();

// 进程级兜底：单个 bot/异步异常不拖垮整个进程（否则一个租户/连接报错全体下线）
process.on('unhandledRejection', (e) => console.error('[进程] 未处理的 Promise 拒绝:', e?.message || e));
process.on('uncaughtException', (e) => console.error('[进程] 未捕获异常:', e?.message || e));

process.on('SIGINT', () => { console.log('\n👋 退出中…'); process.exit(0); });

