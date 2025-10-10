// k6 Load Test: Login Storm
// Tests authentication under sustained high load
// Usage: k6 run login-storm.js

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom metrics
const loginFailureRate = new Rate('login_failures');
const loginDuration = new Trend('login_duration');
const authTokensIssued = new Counter('auth_tokens_issued');
const rateLimitHits = new Counter('rate_limit_hits');

// Test configuration
export let options = {
  stages: [
    { duration: '1m', target: 100 },   // Quick ramp up
    { duration: '3m', target: 500 },   // Moderate load
    { duration: '5m', target: 1000 },  // High load
    { duration: '10m', target: 2000 }, // Peak sustained load
    { duration: '5m', target: 5000 },  // Extreme spike
    { duration: '2m', target: 0 },     // Cool down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],      // 95% under 500ms
    http_req_failed: ['rate<0.01'],        // <1% failure rate
    login_failures: ['rate<0.005'],        // <0.5% login failures
    login_duration: ['p(95)<300'],         // 95% logins under 300ms
    rate_limit_hits: ['count<100'],        // <100 rate limit hits total
  },
};

// Pre-created test users (simulate existing user base)
const testUsers = [
  { email: 'user1@loadtest.com', password: 'LoadTest123!@#' },
  { email: 'user2@loadtest.com', password: 'LoadTest123!@#' },
  { email: 'user3@loadtest.com', password: 'LoadTest123!@#' },
  { email: 'user4@loadtest.com', password: 'LoadTest123!@#' },
  { email: 'user5@loadtest.com', password: 'LoadTest123!@#' },
  // Add more users as needed
];

// Generate additional test users dynamically
function generateTestUser() {
  const userId = Math.floor(Math.random() * 10000);
  return {
    email: `loadtest${userId}@example.com`,
    password: 'LoadTest123!@#'
  };
}

// Get random user credentials
function getRandomUser() {
  if (Math.random() < 0.8) {
    // 80% chance to use pre-created users (simulate returning users)
    return testUsers[Math.floor(Math.random() * testUsers.length)];
  } else {
    // 20% chance to use new users (simulate new user logins)
    return generateTestUser();
  }
}

// Main test function
export default function() {
  const baseUrl = __ENV.BASE_URL || 'http://localhost:4001';
  const user = getRandomUser();
  
  // Login request
  const loginStart = Date.now();
  const response = http.post(`${baseUrl}/v1/auth/login`, JSON.stringify({
    email: user.email,
    password: user.password,
    rememberMe: Math.random() < 0.3 // 30% chance to remember
  }), {
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': `k6-load-test-${__VU}`,
    },
    timeout: '10s',
  });
  
  const loginEnd = Date.now();
  const duration = loginEnd - loginStart;
  
  // Record custom metrics
  loginDuration.add(duration);
  
  // Check for rate limiting
  if (response.status === 429) {
    rateLimitHits.add(1);
    console.warn(`Rate limit hit for user ${user.email}`);
  }
  
  // Record failures and successes
  const isSuccess = response.status === 200;
  loginFailureRate.add(!isSuccess);
  
  if (isSuccess) {
    authTokensIssued.add(1);
  }
  
  // Validate response
  const success = check(response, {
    'login status is 200': (r) => r.status === 200,
    'not rate limited': (r) => r.status !== 429,
    'response has success field': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.success === true;
      } catch {
        return false;
      }
    },
    'response has access token': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.data && body.data.accessToken && body.data.accessToken.length > 0;
      } catch {
        return false;
      }
    },
    'response has user data': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.data && body.data.user && body.data.user.id;
      } catch {
        return false;
      }
    },
    'response time < 500ms': (r) => r.timings.duration < 500,
    'response time < 1000ms': (r) => r.timings.duration < 1000,
  });
  
  // Log failures for debugging
  if (!success && response.status !== 429) {
    console.error(`Login failed for ${user.email}: ${response.status} ${response.body.substring(0, 200)}`);
  }
  
  // Simulate user behavior after successful login
  if (response.status === 200) {
    try {
      const responseBody = JSON.parse(response.body);
      const accessToken = responseBody.data.accessToken;
      
      // Simulate authenticated request (e.g., get user profile)
      sleep(0.5); // Brief pause
      
      const profileResponse = http.get(`${baseUrl}/v1/auth/me`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: '5s',
      });
      
      check(profileResponse, {
        'profile request successful': (r) => r.status === 200,
        'profile response time < 200ms': (r) => r.timings.duration < 200,
      });
      
    } catch (e) {
      console.error(`Error in post-login request: ${e.message}`);
    }
  }
  
  // Variable sleep to simulate real user behavior
  sleep(Math.random() * 3 + 0.5); // 0.5-3.5 seconds
}

// Setup function
export function setup() {
  console.log('Starting login storm load test...');
  console.log(`Target URL: ${__ENV.BASE_URL || 'http://localhost:4001'}`);
  console.log('Test will simulate sustained high-volume login attempts');
  
  const baseUrl = __ENV.BASE_URL || 'http://localhost:4001';
  
  // Health check
  const healthCheck = http.get(`${baseUrl}/health`);
  if (healthCheck.status !== 200) {
    throw new Error(`Service health check failed: ${healthCheck.status}`);
  }
  
  // Pre-create some test users if needed
  console.log('Creating test users for load test...');
  
  for (let i = 0; i < 5; i++) {
    const user = {
      email: `user${i + 1}@loadtest.com`,
      password: 'LoadTest123!@#',
      displayName: `Load Test User ${i + 1}`,
      collegeId: 'test-college-id',
      department: 'Computer Science'
    };
    
    const registerResponse = http.post(`${baseUrl}/v1/auth/register`, JSON.stringify(user), {
      headers: { 'Content-Type': 'application/json' },
      timeout: '10s',
    });
    
    if (registerResponse.status === 201) {
      console.log(`Created test user: ${user.email}`);
    } else if (registerResponse.status === 409) {
      console.log(`Test user already exists: ${user.email}`);
    } else {
      console.warn(`Failed to create test user ${user.email}: ${registerResponse.status}`);
    }
  }
  
  console.log('Test users ready, starting login storm...');
  return { baseUrl };
}

// Teardown function
export function teardown(data) {
  console.log('Login storm load test completed');
  console.log('Performance summary:');
  console.log('- Check login_duration for response time metrics');
  console.log('- Check login_failures for error rates');
  console.log('- Check rate_limit_hits for rate limiting effectiveness');
  console.log('- Check auth_tokens_issued for successful authentications');
}
