import { EventEmitter } from 'events';

// P1-2: College lifecycle event system
export interface CollegeEvents {
  'college.viewed': {
    collegeId: string;
    collegeName: string;
    viewedBy: string;
    userRole: string[];
    timestamp: Date;
    metadata?: Record<string, any>;
  };
  
  'college.searched': {
    searchTerm?: string;
    filters: Record<string, any>;
    resultCount: number;
    searchedBy: string;
    timestamp: Date;
  };
  
  'college.departments_accessed': {
    collegeId: string;
    collegeName: string;
    departmentCount: number;
    accessedBy: string;
    timestamp: Date;
  };
  
  'college.created': {
    collegeId: string;
    collegeName: string;
    createdBy: string;
    timestamp: Date;
  };
  
  'college.updated': {
    collegeId: string;
    changes: Record<string, any>;
    updatedBy: string;
    timestamp: Date;
  };
  
  'college.verified': {
    collegeId: string;
    verifiedBy: string;
    timestamp: Date;
  };
}

class CollegeEventEmitter extends EventEmitter {
  // Type-safe event emission
  emit<K extends keyof CollegeEvents>(
    event: K,
    data: CollegeEvents[K]
  ): boolean {
    console.log(`[COLLEGE_EVENT] ${event}:`, data);
    return super.emit(event, data);
  }

  // Type-safe event listening
  on<K extends keyof CollegeEvents>(
    event: K,
    listener: (data: CollegeEvents[K]) => void
  ): this {
    return super.on(event, listener);
  }

  // Type-safe one-time event listening
  once<K extends keyof CollegeEvents>(
    event: K,
    listener: (data: CollegeEvents[K]) => void
  ): this {
    return super.once(event, listener);
  }
}

// Singleton event emitter
export const collegeEventEmitter = new CollegeEventEmitter();

// Event emission helpers
export const emitCollegeEvent = <K extends keyof CollegeEvents>(
  event: K,
  data: CollegeEvents[K]
): void => {
  try {
    collegeEventEmitter.emit(event, data);
  } catch (error) {
    console.error(`[COLLEGE_EVENT_ERROR] Failed to emit ${event}:`, error);
  }
};

// Event listeners for common operations
collegeEventEmitter.on('college.viewed', (data) => {
  // Track college view analytics
  console.log(`[ANALYTICS] College ${data.collegeName} viewed by ${data.viewedBy}`);
});

collegeEventEmitter.on('college.searched', (data) => {
  // Track search analytics
  console.log(`[ANALYTICS] College search: "${data.searchTerm}" returned ${data.resultCount} results`);
});

collegeEventEmitter.on('college.departments_accessed', (data) => {
  // Track department access patterns
  console.log(`[ANALYTICS] Departments accessed for ${data.collegeName} (${data.departmentCount} departments)`);
});

// Future: Add webhook notifications, cache invalidation, etc.
collegeEventEmitter.on('college.updated', (data) => {
  // Invalidate cache
  console.log(`[CACHE] Invalidating cache for college ${data.collegeId}`);
  
  // Future: Send webhook notifications
  // await sendWebhookNotification('college.updated', data);
});

export default collegeEventEmitter;
