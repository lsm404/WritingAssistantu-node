FROM node:22-alpine

WORKDIR /app

# 复制 package.json 和 package-lock.json
COPY package*.json ./

# 安装依赖 (生产环境推荐用 npm ci)
RUN npm ci

# 复制项目源代码
COPY . .

# 生成 Prisma Client（建表在容器启动时用 db push，见 CMD）
RUN npx prisma generate

# 暴露端口
EXPOSE 3100

# 每次启动先把 schema 同步到数据库（本项目未提交 migrate 历史，线上用 db push）
# 注意：重启 Docker 只会重启进程，不会自动改库结构，必须执行这类命令或由这里代为执行
CMD ["sh", "-c", "npx prisma db push --skip-generate && npm run start"]
