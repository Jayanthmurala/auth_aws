import { prisma } from '../db';

interface User {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  avatarUrl?: string | null;
  collegeId?: string | null;
  department?: string | null;
  year?: number | null;
  collegeMemberId?: string | null;
}

export class ProfileInitializationService {
  private static readonly PROFILE_SERVICE_URL = process.env.PROFILE_SERVICE_URL || 'http://localhost:4003';
  private static readonly MAX_RETRIES = 3;
  private static readonly RETRY_DELAY = 2000; // 2 seconds

  /**
   * Asynchronously initialize user profile in profile-service
   * This runs in the background and doesn't block the login process
   */
  static async initializeUserProfileAsync(user: User): Promise<void> {
    // Don't await - run in background
    this.createUserProfileWithRetry(user).catch(error => {
      console.error(`[ProfileInit] Failed to initialize profile for user ${user.id}:`, error);
      // Store failed initialization for later retry
      this.storePendingProfileInit(user.id);
    });
  }

  /**
   * Create user profile with retry mechanism
   */
  private static async createUserProfileWithRetry(user: User, attempt = 1): Promise<void> {
    try {
      console.log(`[ProfileInit] Attempting to create profile for user ${user.id} (attempt ${attempt})`);
      
      // Check if profile already exists
      const existingProfile = await this.checkProfileExists(user.id);
      if (existingProfile) {
        console.log(`[ProfileInit] Profile already exists for user ${user.id}`);
        return;
      }

      // Create profile in profile-service
      await this.createProfile(user);
      console.log(`[ProfileInit] Successfully created profile for user ${user.id}`);
      
      // Remove from pending list if it was there
      await this.removePendingProfileInit(user.id);
      
    } catch (error) {
      console.error(`[ProfileInit] Attempt ${attempt} failed for user ${user.id}:`, error);
      
      if (attempt < this.MAX_RETRIES) {
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY * attempt));
        return this.createUserProfileWithRetry(user, attempt + 1);
      } else {
        // All retries failed
        throw new Error(`Failed to create profile after ${this.MAX_RETRIES} attempts`);
      }
    }
  }

  /**
   * Check if user profile exists in profile-service
   */
  private static async checkProfileExists(userId: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.PROFILE_SERVICE_URL}/v1/profiles/${userId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      return response.ok;
    } catch (error) {
      console.error(`[ProfileInit] Error checking profile existence:`, error);
      return false;
    }
  }

  /**
   * Create user profile in profile-service
   */
  private static async createProfile(user: User): Promise<void> {
    const profileData = {
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      avatar: user.avatarUrl || null,
      bio: null,
      skills: [],
      expertise: [],
      year: user.year || null,
      collegeMemberId: user.collegeMemberId || null,
      contactInfo: null,
      linkedIn: null,
      github: null,
      resumeUrl: null,
      twitter: null,
      collegeId: user.collegeId || null,
      department: user.department || null,
    };

    const response = await fetch(`${this.PROFILE_SERVICE_URL}/v1/profiles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(profileData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Profile creation failed: ${response.status} ${errorText}`);
    }
  }

  /**
   * Store pending profile initialization for later retry
   */
  private static async storePendingProfileInit(userId: string): Promise<void> {
    try {
      // Store in a simple table for tracking failed profile initializations
      await prisma.$executeRaw`
        INSERT INTO "PendingProfileInit" ("userId", "createdAt", "retryCount")
        VALUES (${userId}, NOW(), 1)
        ON CONFLICT ("userId") 
        DO UPDATE SET "retryCount" = "PendingProfileInit"."retryCount" + 1, "updatedAt" = NOW()
      `;
    } catch (error) {
      console.error(`[ProfileInit] Failed to store pending profile init:`, error);
    }
  }

  /**
   * Remove from pending profile initialization list
   */
  private static async removePendingProfileInit(userId: string): Promise<void> {
    try {
      await prisma.$executeRaw`DELETE FROM "PendingProfileInit" WHERE "userId" = ${userId}`;
    } catch (error) {
      console.error(`[ProfileInit] Failed to remove pending profile init:`, error);
    }
  }

  /**
   * Retry failed profile initializations (can be called by a cron job)
   */
  static async retryPendingProfileInits(): Promise<void> {
    try {
      const pendingInits = await prisma.$queryRaw<Array<{userId: string, retryCount: number}>>`
        SELECT "userId", "retryCount" 
        FROM "PendingProfileInit" 
        WHERE "retryCount" < ${this.MAX_RETRIES}
        AND "updatedAt" < NOW() - INTERVAL '5 minutes'
      `;

      for (const pending of pendingInits) {
        const user = await prisma.user.findUnique({
          where: { id: pending.userId },
          select: {
            id: true,
            email: true,
            displayName: true,
            roles: true,
            avatarUrl: true,
            collegeId: true,
            department: true,
            year: true,
            collegeMemberId: true,
          },
        });

        if (user) {
          console.log(`[ProfileInit] Retrying profile creation for user ${user.id}`);
          this.initializeUserProfileAsync(user);
        }
      }
    } catch (error) {
      console.error(`[ProfileInit] Error retrying pending profile inits:`, error);
    }
  }
}
