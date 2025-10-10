import { PrismaClient, Role, UserStatus } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function createTestUsers() {
  try {
    console.log('Creating test users...');

    // Create test colleges first
    const college1 = await prisma.college.upsert({
      where: { code: 'MIT' },
      update: {},
      create: {
        name: 'Massachusetts Institute of Technology',
        code: 'MIT',
        location: 'Cambridge, MA',
        departments: ['Computer Science', 'Electrical Engineering', 'Mechanical Engineering'],
        isActive: true
      }
    });

    const college2 = await prisma.college.upsert({
      where: { code: 'STANFORD' },
      update: {},
      create: {
        name: 'Stanford University',
        code: 'STANFORD',
        location: 'Stanford, CA',
        departments: ['Computer Science', 'Business', 'Medicine'],
        isActive: true
      }
    });

    // Create test users
    const testUsers = [
      {
        email: 'john.doe@mit.edu',
        displayName: 'John Doe',
        department: 'Computer Science',
        collegeId: college1.id,
        year: 3,
        roles: [Role.STUDENT]
      },
      {
        email: 'jane.smith@mit.edu',
        displayName: 'Jane Smith',
        department: 'Electrical Engineering',
        collegeId: college1.id,
        year: 2,
        roles: [Role.STUDENT]
      },
      {
        email: 'prof.wilson@mit.edu',
        displayName: 'Prof. Wilson',
        department: 'Computer Science',
        collegeId: college1.id,
        roles: [Role.FACULTY]
      },
      {
        email: 'alice.johnson@stanford.edu',
        displayName: 'Alice Johnson',
        department: 'Computer Science',
        collegeId: college2.id,
        year: 4,
        roles: [Role.STUDENT]
      },
      {
        email: 'bob.brown@stanford.edu',
        displayName: 'Bob Brown',
        department: 'Business',
        collegeId: college2.id,
        year: 1,
        roles: [Role.STUDENT]
      },
      {
        email: 'test.user@example.com',
        displayName: 'Test User',
        department: 'Computer Science',
        collegeId: college1.id,
        year: 2,
        roles: [Role.STUDENT]
      }
    ];

    const passwordHash = await bcrypt.hash('password123', 10);

    for (const userData of testUsers) {
      const user = await prisma.user.upsert({
        where: { email: userData.email },
        update: {},
        create: {
          ...userData,
          passwordHash,
          status: UserStatus.ACTIVE,
          emailVerifiedAt: new Date()
        }
      });
      console.log(`Created user: ${user.displayName} (${user.email})`);
    }

    console.log('✅ Test users created successfully!');
    console.log('\nYou can now login with:');
    console.log('Email: test.user@example.com');
    console.log('Password: password123');

  } catch (error) {
    console.error('Error creating test users:', error);
  } finally {
    await prisma.$disconnect();
  }
}

createTestUsers();
