/**
 * Seed script to create the initial SUPER_ADMIN user in auth-service
 */

import { PrismaClient, Role } from '@prisma/client';
import argon2 from 'argon2';
import * as dotenv from 'dotenv';

const prisma = new PrismaClient();

// Load environment variables
dotenv.config();

async function seedSuperAdmin() {
  try {
    console.log('🌱 Starting SUPER_ADMIN seed for auth-service...');

    const superAdminEmail = 'superadmin@nexus.in';
    const superAdminPassword = '@NexUsV1';

    // Check if super admin already exists
    const existingSuperAdmin = await prisma.user.findUnique({
      where: { email: superAdminEmail }
    });

    if (existingSuperAdmin) {
      console.log('🔄 SUPER_ADMIN user already exists, updating with correct password hash...');
      
      // Hash the password with Argon2
      console.log('🔐 Hashing password with Argon2...');
      const passwordHash = await argon2.hash(superAdminPassword, { type: argon2.argon2id });
      
      // Update the existing user with correct password hash and ensure SUPER_ADMIN role
      const roles: Role[] = existingSuperAdmin.roles.includes(Role.SUPER_ADMIN) 
        ? existingSuperAdmin.roles 
        : [...existingSuperAdmin.roles, Role.SUPER_ADMIN];
        
      await prisma.user.update({
        where: { id: existingSuperAdmin.id },
        data: {
          passwordHash,
          roles,
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
        },
      });
      
      console.log('✅ SUPER_ADMIN user updated successfully!');
      console.log('📧 Email:', existingSuperAdmin.email);
      console.log('🆔 User ID:', existingSuperAdmin.id);
      console.log('🔑 Roles:', roles);
      console.log('\n🎉 Super Admin seed completed successfully!');
      console.log('\n📝 Login Credentials:');
      console.log('   Email:', superAdminEmail);
      console.log('   Password:', superAdminPassword);
      console.log('\n⚠️  Please change the password after first login for security!');
      
      return;
    }

    // Hash the password
    console.log('🔐 Hashing password...');
    const passwordHash = await argon2.hash(superAdminPassword, { type: argon2.argon2id });

    // Create the super admin user
    console.log('👤 Creating SUPER_ADMIN user...');
    const superAdmin = await prisma.user.create({
      data: {
        email: superAdminEmail,
        passwordHash,
        displayName: 'Super Administrator',
        roles: [Role.SUPER_ADMIN],
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        tokenVersion: 0
      }
    });

    console.log('✅ SUPER_ADMIN user created successfully!');
    console.log('📧 Email:', superAdmin.email);
    console.log('🆔 User ID:', superAdmin.id);
    console.log('🔑 Roles:', superAdmin.roles);
    console.log('📅 Created At:', superAdmin.createdAt);

    console.log('\n🎉 Super Admin seed completed successfully!');
    console.log('\n📝 Login Credentials:');
    console.log('   Email:', superAdminEmail);
    console.log('   Password:', superAdminPassword);
    console.log('\n⚠️  Please change the password after first login for security!');

  } catch (error) {
    console.error('❌ Error seeding SUPER_ADMIN:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the seed function
seedSuperAdmin()
  .then(() => {
    console.log('🏁 Seed script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Seed script failed:', error);
    process.exit(1);
  });

export { seedSuperAdmin };
