FROM node:22-alpine

WORKDIR /app

# 复制 package.json 和 package-lock.json
COPY package*.json ./

# 安装依赖 (生产环境推荐用 npm ci)
RUN npm ci

# 复制项目源代码
COPY . .

# 生成 Prisma Client
RUN npx prisma generate

# 暴露端口
EXPOSE 3100

# 生产环境只负责启动应用；数据库变更在部署流程中单独执行
CMD ["npm", "run", "start"]
