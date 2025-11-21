import { prisma } from '../db.js';
import { env } from '../config/env.js';
import { createHmac } from 'crypto';

interface User {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string | null;
  collegeId?: string | null;
  department?: string | null;
  year?: number | null;
}

export class ProfileInitializationService {
  private static readonly PROFILE_SERVICE_URL = process.env.PROFILE_SERVICE_URL || 'http://localhost:4002';
  private static readonly MAX_RETRIES = 3;
  private static readonly RETRY_DELAY_MS = 1000; // 1 second between retries
  private static readonly PROFILE_CHECK_TIMEOUT_MS = 5000; // 5 seconds to check if profile exists
  private static readonly PROFILE_CREATION_TIMEOUT_MS = 5000; // 5 seconds timeout for profile creation during login

  /**
   * Synchronously initialize user profile during login
   * This BLOCKS login until profile is created or timeout is reached
   * Maximum wait time: 5 seconds
   * If profile creation fails, login still succeeds (graceful degradation)
   */
  static async initializeUserProfileSync(user: User): Promise<void> {
    try {
      console.log(`[ProfileInit] Starting synchronous profile creation for user ${user.id}`);
      
      // Create profile with timeout
      await this.withTimeout(
        this.createUserProfileWithRetry(user),
        this.PROFILE_CREATION_TIMEOUT_MS,
        `Profile creation for user ${user.id}`
      );
      
      console.log(`[ProfileInit] Profile created successfully for user ${user.id}`);
    } catch (error) {
      // Log the error but don't throw - login should still succeed
      console.warn(`[ProfileInit] Profile creation failed during login (non-blocking):`, 
        error instanceof Error ? error.message : String(error));
      // Profile will be created asynchronously in background
      this.createUserProfileWithRetry(user).catch(bgError => {
        console.warn(`[ProfileInit] Background profile creation also failed:`, 
          bgError instanceof Error ? bgError.message : String(bgError));
      });
    }
  }

  /**
   * Asynchronously initialize user profile in profile-service
   * This runs in the background and doesn't block the login process
   * Profile initialization is optional - login succeeds even if it fails
   */
  static async initializeUserProfileAsync(user: User): Promise<void> {
    // Don't await - run in background
    this.createUserProfileWithRetry(user).catch(error => {
      console.warn(`[ProfileInit] Profile initialization failed (non-blocking):`, error instanceof Error ? error.message : String(error));
      // Don't store pending init - profile service will be updated separately
      // For now, just log and continue - login already succeeded
    });
  }

  /**
   * Helper: Execute promise with timeout
   */
  private static withTimeout<T>(promise: Promise<T>, timeoutMs: number, operationName: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`${operationName} timed out after ${timeoutMs}ms`)), timeoutMs)
      )
    ]);
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
        await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY_MS * attempt));
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
   * Create user profile in profile-service via HTTP API
   */
  private static async createProfile(user: User): Promise<void> {
    // Only include fields that profile service expects
    const profileData = {
      userId: user.id,
      collegeId: user.collegeId || undefined,
      department: user.department || undefined,
      year: user.year || undefined,
      bio: "",
      skills: [],
      resumeUrl: "",
      linkedIn: "",
      github: "",
    };

    // Profile endpoint is now public - no authentication needed
    console.log(`[ProfileInit] Creating profile for user ${profileData.userId}`);

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
   * Uses Prisma client for better error handling
   */
  private static async storePendingProfileInit(userId: string): Promise<void> {
    try {
      // Try to store in database table using Prisma
      await prisma.pendingProfileInit.upsert({
        where: { userId },
        update: { 
          retryCount: { increment: 1 },
          updatedAt: new Date()
        },
        create: {
          userId,
          retryCount: 1
        }
      });
    } catch (dbError) {
      // If table doesn't exist, log but don't fail
      console.warn(`[ProfileInit] Database table not available, skipping pending profile storage:`, 
        dbError instanceof Error ? dbError.message : String(dbError));
      // In production, could use Redis as fallback here
    }
  }

  /**
   * Remove from pending profile initialization list
   */
  private static async removePendingProfileInit(userId: string): Promise<void> {
    try {
      // Use Prisma client instead of raw SQL to avoid table existence issues
      await prisma.pendingProfileInit.delete({
        where: { userId }
      }).catch(() => {
        // Silently ignore if record doesn't exist
      });
    } catch (error) {
      // Silently ignore - table might not exist or record might not exist
      // This is non-critical cleanup
    }
  }

  /**
   * Retry failed profile initializations (can be called by a cron job)
   */
  static async retryPendingProfileInits(): Promise<void> {
    try {
      // Use Prisma client to query pending inits
      const pendingInits = await prisma.pendingProfileInit.findMany({
        where: {
          retryCount: { lt: this.MAX_RETRIES },
          updatedAt: { lt: new Date(Date.now() - 5 * 60 * 1000) } // 5 minutes ago
        }
      });

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
      // Table might not exist - log but don't fail
      console.warn(`[ProfileInit] Error retrying pending profile inits (table may not exist):`, 
        error instanceof Error ? error.message : String(error));
    }
  }
}
