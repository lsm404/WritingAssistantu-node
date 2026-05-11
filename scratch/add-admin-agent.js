import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const code = "OPENCLAW";
  const name = "超级管理员(官方)";

  const existing = await prisma.agent.findUnique({
    where: { inviteCode: code },
  });

  if (existing) {
    console.log(`[OK] 注册码 ${code} 已经存在了。`);
    return;
  }

  const agent = await prisma.agent.create({
    data: {
      name,
      inviteCode: code,
      status: "active",
    },
  });

  console.log(`[SUCCESS] 已成功添加超管注册码：`);
  console.log(`- 姓名: ${agent.name}`);
  console.log(`- 注册码: ${agent.inviteCode}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
