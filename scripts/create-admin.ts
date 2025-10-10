import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function createAdmin() {
  const email = "jayanthAdmin@nexus.in";
  const password = "Jayanthmurala@Admin";
  const displayName = "Jayanth Admin";

  try {
    // Check if admin already exists
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      console.log(`Admin user already exists: ${email}`);
      return;
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create admin user
    const user = await prisma.user.create({
      data: {
        email,
        displayName,
        passwordHash,
        emailVerifiedAt: new Date(),
        status: "ACTIVE",
        roles: ["SUPER_ADMIN"],
        preferences: { create: {} },
      },
    });

    console.log(`✅ Created super admin user: ${user.email} (${user.id})`);
    console.log(`Email: ${email}`);
    console.log(`Password: ${password}`);
    console.log(`Role: SUPER_ADMIN`);
  } catch (error) {
    console.error("❌ Error creating admin user:", error);
  } finally {
    await prisma.$disconnect();
  }
}

createAdmin();
