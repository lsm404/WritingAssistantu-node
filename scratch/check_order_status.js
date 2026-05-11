import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const order = await prisma.order.findFirst();
  console.log('Order status example:', order?.status);
  const userCount = await prisma.user.count();
  console.log('User count:', userCount);
}

main().catch(e => console.error(e)).finally(() => prisma.$disconnect());
