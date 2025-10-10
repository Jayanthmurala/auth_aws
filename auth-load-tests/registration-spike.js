// k6 Load Test: Registration Spike
// Tests user registration under high load
// Usage: k6 run registration-spike.js

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const registrationFailureRate = new Rate('registration_failures');
const registrationDuration = new Trend('registration_duration');

// Test configuration
export let options = {
  stages: [
    { duration: '2m', target: 50 },    // Warm up
    { duration: '5m', target: 200 },   // Normal load
    { duration: '2m', target: 500 },   // Spike load
    { duration: '5m', target: 1000 },  // Peak load
    { duration: '3m', target: 0 },     // Cool down
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'],     // 95% under 2s
    http_req_failed: ['rate<0.05'],        // <5% failure rate
    registration_failures: ['rate<0.02'],  // <2% registration failures
    registration_duration: ['p(95)<1000'], // 95% registrations under 1s
  },
};

// Test data generators
function generateEmail() {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 10000);
  return `testuser${timestamp}${random}@loadtest.com`;
}

function generateUser() {
  const userId = Math.floor(Math.random() * 100000);
  return {
    email: generateEmail(),
    password: 'LoadTest123!@#',
    displayName: `Load Test User ${userId}`,
    collegeId: 'test-college-id',
    department: 'Computer Science',
    year: Math.floor(Math.random() * 4) + 1,
    collegeMemberId: `LT${userId}`
  };
}

// Main test function
export default function() {
  const baseUrl = __ENV.BASE_URL || 'http://localhost:4001';
  const user = generateUser();
  
  // Registration request
  const registrationStart = Date.now();
  const response = http.post(`${baseUrl}/v1/auth/register`, JSON.stringify(user), {
    headers: {
      'Content-Type': 'application/json',
    },
    timeout: '30s',
  });
  
  const registrationEnd = Date.now();
  const duration = registrationEnd - registrationStart;
  
  // Record custom metrics
  registrationDuration.add(duration);
  registrationFailureRate.add(response.status !== 201);
  
  // Validate response
  const success = check(response, {
    'registration status is 201': (r) => r.status === 201,
    'response has success field': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.success === true;
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
    'response has access token': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.data && body.data.accessToken;
      } catch {
        return false;
      }
    },
    'response time < 2000ms': (r) => r.timings.duration < 2000,
  });
  
  if (!success) {
    console.error(`Registration failed for ${user.email}: ${response.status} ${response.body}`);
  }
  
  // Brief pause between requests
  sleep(Math.random() * 2 + 1); // 1-3 seconds
}

// Setup function (runs once before test)
export function setup() {
  console.log('Starting registration spike load test...');
  console.log(`Target URL: ${__ENV.BASE_URL || 'http://localhost:4001'}`);
  console.log('Test will simulate user registration under increasing load');
  
  // Verify service is accessible
  const baseUrl = __ENV.BASE_URL || 'http://localhost:4001';
  const healthCheck = http.get(`${baseUrl}/health`);
  
  if (healthCheck.status !== 200) {
    throw new Error(`Service health check failed: ${healthCheck.status}`);
  }
  
  console.log('Service health check passed, starting load test...');
  return { baseUrl };
}

// Teardown function (runs once after test)
export function teardown(data) {
  console.log('Registration spike load test completed');
  console.log('Check the results for performance metrics and failure rates');
}
