import 'dotenv/config';
import { PrismaClient, Role } from '@prisma/client';

const prisma = new PrismaClient();

function parseRoles(input: string | undefined): Role[] {
  if (!input) return [];
  return input
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .map((s) => s as Role);
}

async function main() {
  const email = process.env.PROMOTE_EMAIL;
  const addRoles = parseRoles(process.env.PROMOTE_ADD_ROLES || 'FACULTY');

  if (!email) {
    console.error('[promote] Please set PROMOTE_EMAIL env var');
    process.exit(1);
  }
  if (addRoles.length === 0) {
    console.error('[promote] No roles specified in PROMOTE_ADD_ROLES');
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`[promote] User not found: ${email}`);
    process.exit(1);
  }

  const current = new Set((user.roles || []) as Role[]);
  for (const r of addRoles) current.add(r);
  const nextRoles = Array.from(current);

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { roles: { set: nextRoles } },
  });

  console.log(`[promote] Updated roles for ${updated.email}:`, updated.roles);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
