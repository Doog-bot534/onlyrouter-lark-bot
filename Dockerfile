# OnlyRouter Lark 机器人 · 容器镜像
FROM node:20-slim

WORKDIR /app

# 先装依赖（利用层缓存）
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# 再拷源码和知识库
COPY src ./src
COPY knowledge ./knowledge
COPY web ./web

# data/ 用卷持久化提问记录
VOLUME ["/app/data"]

CMD ["node", "src/index.js"]
