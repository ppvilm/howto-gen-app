/* eslint-disable no-console */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_USER_EMAIL || 'demo@example.com';
  const password = process.env.SEED_USER_PASSWORD || 'demo1234';

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`User already exists: ${email}`);
    return;
  }

  const account = await prisma.account.create({ data: { name: 'Demo Account' } });
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      accountId: account.id,
    },
  });

  // Create a default workspace for the account
  const workspaceId = 'demo';
  await prisma.workspace.upsert({
    where: { id: workspaceId },
    update: {},
    create: {
      id: workspaceId,
      name: 'Demo Workspace',
      accountId: account.id,
    },
  });

  console.log('Seed completed.');
  console.log('Email:', email);
  console.log('Password:', password);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

