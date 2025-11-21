/**
 * PHASE 3: User Update Service
 * Publishes user update events to Redis pub/sub
 * Allows other services (profile-service) to react to user changes
 */

import { redis } from '../config/redis.js';

export interface UserUpdatePayload {
  userId: string;
  changes: {
    displayName?: string;
    department?: string;
    year?: number;
    email?: string;
    collegeId?: string;
    roles?: string[];
  };
}

export class UserUpdateService {
  private static readonly CHANNEL = 'auth:user:updated';

  /**
   * Publish user update event
   * Called whenever user data is updated in auth-service
   */
  static async publishUserUpdate(payload: UserUpdatePayload): Promise<void> {
    try {
      const event = {
        ...payload,
        timestamp: new Date().toISOString()
      };

      await redis.publish(this.CHANNEL, JSON.stringify(event));
      console.log('[UserUpdateService] Published user update event:', payload.userId);
    } catch (error) {
      console.error('[UserUpdateService] Failed to publish user update:', error);
      // Non-blocking - don't fail the operation if pub/sub fails
    }
  }

  /**
   * Publish multiple user updates (batch)
   */
  static async publishBatchUserUpdates(payloads: UserUpdatePayload[]): Promise<void> {
    try {
      const promises = payloads.map(payload => this.publishUserUpdate(payload));
      await Promise.all(promises);
      console.log('[UserUpdateService] Published', payloads.length, 'user update events');
    } catch (error) {
      console.error('[UserUpdateService] Failed to publish batch user updates:', error);
    }
  }
}
