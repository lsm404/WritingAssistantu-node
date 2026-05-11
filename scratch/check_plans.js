import { prisma } from '../src/prisma.js';

async function checkPlans() {
  const plans = await prisma.plan.findMany();
  console.log('Plans in DB:', JSON.stringify(plans, null, 2));
}

checkPlans().catch(console.error).finally(() => prisma.$disconnect());
