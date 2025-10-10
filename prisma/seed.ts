/// <reference types="node" />
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";
const prisma = new PrismaClient();

async function main() {
  // Create sample colleges first
  const collegeData = [
    {
      name: "Massachusetts Institute of Technology",
      code: "MIT",
      location: "Cambridge, MA, USA",
      website: "https://mit.edu",
      departments: ["Computer Science", "Electrical Engineering", "Mechanical Engineering", "Physics", "Mathematics"],
    },
    {
      name: "Stanford University",
      code: "STANFORD",
      location: "Stanford, CA, USA", 
      website: "https://stanford.edu",
      departments: ["Computer Science", "Engineering", "Business", "Medicine", "Law"],
    },
    {
      name: "Indian Institute of Technology Delhi",
      code: "IITD",
      location: "New Delhi, India",
      website: "https://iitd.ac.in",
      departments: ["Computer Science and Engineering", "Electrical Engineering", "Mechanical Engineering", "Civil Engineering", "Chemical Engineering"],
    },
  ];

  for (const college of collegeData) {
    const existing = await (prisma as any).college.findUnique({ where: { code: college.code } });
    if (!existing) {
      const created = await (prisma as any).college.create({ data: college });
      console.log(`[seed] Created college: ${created.name} (${created.code})`);
    } else {
      console.log(`[seed] College already exists: ${college.name}`);
    }
  }

  // Create admin user
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const displayName = process.env.ADMIN_DISPLAY_NAME || "Head Admin";

  if (!email || !password) {
    console.log("[seed] Skipping admin seed: ADMIN_EMAIL or ADMIN_PASSWORD not set");
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`[seed] Admin user already exists: ${email}`);
    return;
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  const user = await prisma.user.create({
    data: {
      email,
      displayName,
      passwordHash,
      emailVerifiedAt: new Date(),
      status: "ACTIVE",
      roles: ["HEAD_ADMIN"],
      preferences: { create: {} },
    },
  });

  console.log(`[seed] Created admin user ${user.email} (${user.id})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
