#!/usr/bin/env bash
# OnlyRouter Lark 机器人 · 一键部署脚本（Linux 服务器，systemd 常驻）
#
# 用法：
#   1) 把整个项目上传到服务器，或在服务器上 git clone
#   2) cd 到项目目录，复制并填好 .env： cp .env.example .env && vim .env
#   3) sudo bash deploy/deploy.sh
#
# 脚本会：装 Node（如缺）→ npm install → 注册 systemd 服务 → 开机自启 → 启动
# 之后：查看日志 journalctl -u onlyrouter-lark-bot -f
#       重启     systemctl restart onlyrouter-lark-bot
#       停止     systemctl stop onlyrouter-lark-bot
set -euo pipefail

SERVICE_NAME="onlyrouter-lark-bot"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_USER="${SUDO_USER:-$(whoami)}"

echo "▶ 项目目录：$PROJECT_DIR"
echo "▶ 运行用户：$RUN_USER"

# --- 0. 必须有 .env ---
if [ ! -f "$PROJECT_DIR/.env" ]; then
  echo "❌ 未找到 .env。请先： cp .env.example .env 并填好凭证" >&2
  exit 1
fi

# --- 1. 装 Node.js（缺失时装 20 LTS）---
if ! command -v node >/dev/null 2>&1; then
  echo "▶ 未检测到 Node.js，安装 Node 20 LTS…"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo "▶ Node 版本：$(node -v)"

NODE_BIN="$(command -v node)"

# --- 2. 装依赖 ---
echo "▶ 安装依赖…"
cd "$PROJECT_DIR"
sudo -u "$RUN_USER" npm install --omit=dev --no-audit --no-fund

# --- 3. 写 systemd unit ---
echo "▶ 注册 systemd 服务：$SERVICE_NAME"
cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=OnlyRouter Lark Bot (长连接问答机器人)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$PROJECT_DIR
EnvironmentFile=$PROJECT_DIR/.env
ExecStart=$NODE_BIN $PROJECT_DIR/src/index.js
Restart=always
RestartSec=5
# 崩溃自动重启；长连接断线 SDK 内部会自愈，进程级兜底交给 systemd
StandardOutput=journal
StandardError=journal
SyslogIdentifier=$SERVICE_NAME

[Install]
WantedBy=multi-user.target
EOF

# --- 4. 启动 + 开机自启 ---
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

sleep 2
echo ""
echo "✅ 部署完成。当前状态："
systemctl --no-pager status "$SERVICE_NAME" | head -12 || true
echo ""
echo "👉 实时日志： journalctl -u $SERVICE_NAME -f"
echo "👉 改了 .env 后重启： systemctl restart $SERVICE_NAME"
