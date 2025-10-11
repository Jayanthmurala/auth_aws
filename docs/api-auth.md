# Authentication APIs

## 🔐 Authentication Endpoints

All authentication-related endpoints for user registration, login, password management, and email verification.

**Base Path**: `/v1/auth`

---

## 📝 User Registration

### `POST /v1/auth/register`

Register a new user account.

**Authentication**: Not required  
**Rate Limit**: 5 requests per 15 minutes per IP

#### Request Body
```json
{
  "email": "student@college.edu",
  "password": "SecurePassword123!",
  "firstName": "John",
  "lastName": "Doe",
  "collegeId": "clh7x8y9z0a1b2c3d4e5f6g7",
  "role": "STUDENT",
  "department": "Computer Science"
}
```

#### Response (201 Created)
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "clh7x8y9z0a1b2c3d4e5f6g7",
      "email": "student@college.edu",
      "firstName": "John",
      "lastName": "Doe",
      "role": "STUDENT",
      "status": "PENDING_VERIFICATION",
      "collegeId": "clh7x8y9z0a1b2c3d4e5f6g7",
      "createdAt": "2025-01-01T00:00:00.000Z"
    }
  },
  "message": "Registration successful. Please check your email for verification."
}
```

#### Error Responses
- `400 VALIDATION_ERROR`: Invalid input data
- `409 DUPLICATE_EMAIL`: Email already exists
- `422 WEAK_PASSWORD`: Password doesn't meet requirements

---

## 🔑 User Login

### `POST /v1/auth/login`

Authenticate user and receive JWT tokens.

**Authentication**: Not required  
**Rate Limit**: 5 requests per 15 minutes per IP

#### Request Body
```json
{
  "email": "student@college.edu",
  "password": "SecurePassword123!"
}
```

#### Response (200 OK)
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "clh7x8y9z0a1b2c3d4e5f6g7",
      "email": "student@college.edu",
      "firstName": "John",
      "lastName": "Doe",
      "role": "STUDENT",
      "status": "ACTIVE",
      "collegeId": "clh7x8y9z0a1b2c3d4e5f6g7"
    },
    "tokens": {
      "accessToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
      "refreshToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
      "expiresIn": 900,
      "tokenType": "Bearer"
    },
    "mfaRequired": false
  },
  "message": "Login successful"
}
```

#### MFA Required Response (200 OK)
```json
{
  "success": true,
  "data": {
    "mfaRequired": true,
    "mfaToken": "temp_mfa_token_here",
    "availableMethods": ["totp", "sms", "backup_codes"]
  },
  "message": "MFA verification required"
}
```

#### Error Responses
- `401 INVALID_CREDENTIALS`: Invalid email/password
- `401 ACCOUNT_LOCKED`: Account temporarily locked
- `403 EMAIL_NOT_VERIFIED`: Email verification required
- `403 ACCOUNT_SUSPENDED`: Account suspended

---

## 🚪 User Logout

### `POST /v1/auth/logout`

Logout user and invalidate tokens.

**Authentication**: Required (JWT)

#### Request Headers
```http
Authorization: Bearer <access-token>
```

#### Request Body
```json
{
  "refreshToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

#### Response (200 OK)
```json
{
  "success": true,
  "message": "Logout successful"
}
```

---

## 🔄 Token Refresh

### `POST /v1/auth/refresh`

Refresh expired access token using refresh token.

**Authentication**: Not required (uses refresh token)

#### Request Body
```json
{
  "refreshToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

#### Response (200 OK)
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": 900,
    "tokenType": "Bearer"
  },
  "message": "Token refreshed successfully"
}
```

#### Error Responses
- `401 TOKEN_INVALID`: Invalid refresh token
- `401 TOKEN_EXPIRED`: Refresh token expired

---

## 📧 Password Reset

### `POST /v1/auth/forgot-password`

Request password reset email.

**Authentication**: Not required  
**Rate Limit**: 3 requests per hour per email

#### Request Body
```json
{
  "email": "student@college.edu"
}
```

#### Response (200 OK)
```json
{
  "success": true,
  "message": "Password reset email sent if account exists"
}
```

### `POST /v1/auth/reset-password`

Reset password using token from email.

**Authentication**: Not required

#### Request Body
```json
{
  "token": "password_reset_token_from_email",
  "newPassword": "NewSecurePassword123!"
}
```

#### Response (200 OK)
```json
{
  "success": true,
  "message": "Password reset successful"
}
```

#### Error Responses
- `400 TOKEN_INVALID`: Invalid or expired reset token
- `422 WEAK_PASSWORD`: Password doesn't meet requirements

---

## ✉️ Email Verification

### `POST /v1/auth/verify-email`

Verify email address using token from email.

**Authentication**: Not required

#### Request Body
```json
{
  "token": "email_verification_token_from_email"
}
```

#### Response (200 OK)
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "clh7x8y9z0a1b2c3d4e5f6g7",
      "email": "student@college.edu",
      "status": "ACTIVE"
    }
  },
  "message": "Email verified successfully"
}
```

### `POST /v1/auth/resend-verification`

Resend email verification.

**Authentication**: Not required  
**Rate Limit**: 3 requests per hour per email

#### Request Body
```json
{
  "email": "student@college.edu"
}
```

#### Response (200 OK)
```json
{
  "success": true,
  "message": "Verification email sent if account exists"
}
```

---

## 👤 Current User Profile

### `GET /v1/auth/me`

Get current authenticated user's profile.

**Authentication**: Required (JWT)

#### Request Headers
```http
Authorization: Bearer <access-token>
```

#### Response (200 OK)
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "clh7x8y9z0a1b2c3d4e5f6g7",
      "email": "student@college.edu",
      "firstName": "John",
      "lastName": "Doe",
      "role": "STUDENT",
      "status": "ACTIVE",
      "collegeId": "clh7x8y9z0a1b2c3d4e5f6g7",
      "department": "Computer Science",
      "profilePicture": "https://example.com/profile.jpg",
      "mfaEnabled": true,
      "emailVerified": true,
      "createdAt": "2025-01-01T00:00:00.000Z",
      "lastLoginAt": "2025-01-01T12:00:00.000Z"
    },
    "permissions": [
      "read:own_profile",
      "update:own_profile",
      "read:college_info"
    ]
  }
}
```

---

## 🔐 Multi-Factor Authentication Flow

### MFA Login Process

1. **Initial Login**: User provides email/password
2. **MFA Challenge**: If MFA enabled, server responds with `mfaRequired: true`
3. **MFA Verification**: User provides MFA code
4. **Token Issuance**: Server issues JWT tokens

### `POST /v1/auth/mfa/verify`

Complete MFA verification during login.

**Authentication**: Not required (uses MFA token)

#### Request Body
```json
{
  "mfaToken": "temp_mfa_token_from_login",
  "code": "123456",
  "method": "totp"
}
```

#### Response (200 OK)
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "clh7x8y9z0a1b2c3d4e5f6g7",
      "email": "student@college.edu",
      "firstName": "John",
      "lastName": "Doe",
      "role": "STUDENT"
    },
    "tokens": {
      "accessToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
      "refreshToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
      "expiresIn": 900,
      "tokenType": "Bearer"
    }
  },
  "message": "MFA verification successful"
}
```

---

## 🔒 JWT Token Structure

### Access Token Payload
```json
{
  "sub": "clh7x8y9z0a1b2c3d4e5f6g7",
  "email": "student@college.edu",
  "role": "STUDENT",
  "collegeId": "clh7x8y9z0a1b2c3d4e5f6g7",
  "permissions": ["read:own_profile", "update:own_profile"],
  "iat": 1640995200,
  "exp": 1640996100,
  "iss": "nexus-auth",
  "aud": "nexus"
}
```

### Token Expiration
- **Access Token**: 15 minutes
- **Refresh Token**: 30 days
- **MFA Token**: 5 minutes
- **Reset Token**: 1 hour
- **Verification Token**: 24 hours

---

## 🚨 Security Features

### Password Requirements
- Minimum 8 characters
- At least one uppercase letter
- At least one lowercase letter
- At least one number
- At least one special character

### Account Lockout
- 5 failed login attempts
- 15-minute lockout period
- Exponential backoff for repeated failures

### Rate Limiting
- Login attempts: 5 per 15 minutes per IP
- Password reset: 3 per hour per email
- Registration: 5 per 15 minutes per IP

### Security Headers
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Strict-Transport-Security: max-age=31536000`

---

## 📱 Frontend Integration Example

### Login Flow
```javascript
// 1. Login request
const loginResponse = await fetch('/v1/auth/login', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    email: 'student@college.edu',
    password: 'password123'
  })
});

const loginData = await loginResponse.json();

if (loginData.data.mfaRequired) {
  // 2. Handle MFA if required
  const mfaResponse = await fetch('/v1/auth/mfa/verify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      mfaToken: loginData.data.mfaToken,
      code: '123456',
      method: 'totp'
    })
  });
  
  const mfaData = await mfaResponse.json();
  // Store tokens
  localStorage.setItem('accessToken', mfaData.data.tokens.accessToken);
  localStorage.setItem('refreshToken', mfaData.data.tokens.refreshToken);
} else {
  // Store tokens directly
  localStorage.setItem('accessToken', loginData.data.tokens.accessToken);
  localStorage.setItem('refreshToken', loginData.data.tokens.refreshToken);
}
```

### Authenticated Requests
```javascript
const makeAuthenticatedRequest = async (url, options = {}) => {
  const token = localStorage.getItem('accessToken');
  
  const response = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });
  
  if (response.status === 401) {
    // Token expired, try to refresh
    await refreshToken();
    // Retry request with new token
    return makeAuthenticatedRequest(url, options);
  }
  
  return response;
};
```
