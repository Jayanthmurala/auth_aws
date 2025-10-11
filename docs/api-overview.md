# API Overview

## 📋 Complete API Reference

The Nexus Auth Service provides a comprehensive RESTful API for authentication, user management, and administrative functions. All APIs use JSON for request/response bodies and follow consistent patterns.

## 🔗 Base URL

- **Development**: `http://localhost:4001`
- **Production**: `https://your-domain.com`

## 🔐 Authentication

Most endpoints require JWT authentication. Include the token in the Authorization header:

```http
Authorization: Bearer <your-jwt-token>
```

## 📊 API Categories

### 1. Authentication APIs (`/v1/auth`)
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/register` | User registration | ❌ |
| POST | `/login` | User login | ❌ |
| POST | `/logout` | User logout | ✅ |
| POST | `/refresh` | Refresh JWT token | ❌ |
| POST | `/forgot-password` | Request password reset | ❌ |
| POST | `/reset-password` | Reset password with token | ❌ |
| POST | `/verify-email` | Verify email address | ❌ |
| POST | `/resend-verification` | Resend verification email | ❌ |
| GET | `/me` | Get current user profile | ✅ |

### 2. User Management APIs (`/v1/users`)
| Method | Endpoint | Description | Auth Required | Roles |
|--------|----------|-------------|---------------|-------|
| GET | `/profile` | Get user profile | ✅ | All |
| PUT | `/profile` | Update user profile | ✅ | All |
| POST | `/change-password` | Change password | ✅ | All |
| GET | `/` | List users (admin) | ✅ | Admin+ |
| GET | `/:id` | Get user by ID | ✅ | Admin+ |
| PUT | `/:id` | Update user | ✅ | Admin+ |
| DELETE | `/:id` | Delete user | ✅ | Head Admin+ |
| POST | `/:id/roles` | Assign roles | ✅ | Head Admin+ |

### 3. College Management APIs (`/v1/colleges`)
| Method | Endpoint | Description | Auth Required | Roles |
|--------|----------|-------------|---------------|-------|
| GET | `/` | List all colleges | ❌ | Public |
| GET | `/:id` | Get college details | ❌ | Public |
| POST | `/` | Create college | ✅ | Super Admin |
| PUT | `/:id` | Update college | ✅ | Head Admin+ |
| DELETE | `/:id` | Delete college | ✅ | Super Admin |
| GET | `/:id/departments` | Get departments | ❌ | Public |
| POST | `/:id/departments` | Create department | ✅ | Head Admin+ |

### 4. Multi-Factor Authentication APIs (`/v1/mfa`)
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/setup` | Setup MFA | ✅ |
| POST | `/verify` | Verify MFA code | ✅ |
| POST | `/disable` | Disable MFA | ✅ |
| GET | `/backup-codes` | Get backup codes | ✅ |
| POST | `/regenerate-codes` | Regenerate backup codes | ✅ |

### 5. Admin APIs (`/admin`)
| Method | Endpoint | Description | Auth Required | Roles |
|--------|----------|-------------|---------------|-------|
| GET | `/users` | Admin user list | ✅ | Admin+ |
| POST | `/users/bulk-create` | Bulk create users | ✅ | Head Admin+ |
| POST | `/users/bulk-update` | Bulk update users | ✅ | Head Admin+ |
| GET | `/analytics` | User analytics | ✅ | Admin+ |
| GET | `/audit-logs` | Security audit logs | ✅ | Head Admin+ |
| POST | `/export-users` | Export user data | ✅ | Head Admin+ |

### 6. Security APIs (`/security`)
| Method | Endpoint | Description | Auth Required | Roles |
|--------|----------|-------------|---------------|-------|
| GET | `/sessions` | List active sessions | ✅ | All |
| DELETE | `/sessions/:id` | Revoke session | ✅ | All |
| GET | `/login-history` | Login history | ✅ | All |
| POST | `/report-suspicious` | Report suspicious activity | ✅ | All |

### 7. Health & Monitoring APIs
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/health` | Service health check | ❌ |
| GET | `/ready` | Readiness probe | ❌ |
| GET | `/metrics` | Prometheus metrics | ❌ |
| GET | `/version` | Service version | ❌ |

### 8. Internal APIs (`/internal`)
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/verify-token` | Verify JWT token | ✅ (Internal) |
| GET | `/user/:id` | Get user for internal services | ✅ (Internal) |
| POST | `/audit-event` | Log audit event | ✅ (Internal) |

## 🔄 Standard Response Format

### Success Response
```json
{
  "success": true,
  "data": {
    // Response data
  },
  "message": "Operation completed successfully"
}
```

### Error Response
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable error message",
    "details": {
      // Additional error details
    }
  }
}
```

## 📝 Common Request Headers

```http
Content-Type: application/json
Authorization: Bearer <jwt-token>
X-Request-ID: <unique-request-id>
```

## 🔒 Role-Based Access Control

### Role Hierarchy
```
SUPER_ADMIN > HEAD_ADMIN > DEPT_ADMIN > PLACEMENTS_ADMIN > FACULTY > STUDENT
```

### Permission Levels
- **Public**: No authentication required
- **All**: Any authenticated user
- **Faculty+**: Faculty and above
- **Admin+**: Department admin and above
- **Head Admin+**: Head admin and above
- **Super Admin**: Super admin only

## ⚡ Rate Limiting

### Default Limits
- **Authentication endpoints**: 5 requests per 15 minutes
- **General endpoints**: 100 requests per 15 minutes
- **Admin endpoints**: 200 requests per 15 minutes

### Rate Limit Headers
```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1640995200
```

## 🌐 CORS Configuration

### Allowed Origins
- `http://localhost:3000` (Development)
- `http://127.0.0.1:3000` (Development)
- Production domains (configured via environment)

### Allowed Methods
- `GET`, `POST`, `PUT`, `DELETE`, `OPTIONS`

### Allowed Headers
- `Authorization`, `Content-Type`, `X-Request-ID`

## 📊 Pagination

For endpoints that return lists, use query parameters:

```http
GET /v1/users?page=1&limit=20&sort=createdAt&order=desc
```

### Pagination Response
```json
{
  "success": true,
  "data": {
    "items": [...],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 150,
      "pages": 8,
      "hasNext": true,
      "hasPrev": false
    }
  }
}
```

## 🔍 Filtering and Search

### Query Parameters
- `search`: Text search across relevant fields
- `filter[field]`: Filter by specific field
- `sort`: Sort field
- `order`: Sort order (asc/desc)

### Example
```http
GET /v1/users?search=john&filter[role]=STUDENT&sort=name&order=asc
```

## 🚨 Error Codes

### Authentication Errors (4xx)
- `INVALID_CREDENTIALS`: Invalid username/password
- `TOKEN_EXPIRED`: JWT token has expired
- `TOKEN_INVALID`: Invalid JWT token
- `MFA_REQUIRED`: Multi-factor authentication required
- `ACCOUNT_LOCKED`: Account temporarily locked
- `EMAIL_NOT_VERIFIED`: Email verification required

### Authorization Errors (4xx)
- `INSUFFICIENT_PERMISSIONS`: User lacks required permissions
- `ROLE_REQUIRED`: Specific role required for operation
- `RESOURCE_ACCESS_DENIED`: Access to resource denied

### Validation Errors (4xx)
- `VALIDATION_ERROR`: Request validation failed
- `DUPLICATE_EMAIL`: Email already exists
- `WEAK_PASSWORD`: Password doesn't meet requirements
- `INVALID_EMAIL_FORMAT`: Invalid email format

### Server Errors (5xx)
- `INTERNAL_ERROR`: Internal server error
- `DATABASE_ERROR`: Database operation failed
- `EXTERNAL_SERVICE_ERROR`: External service unavailable
- `RATE_LIMIT_EXCEEDED`: Too many requests

## 📱 API Versioning

Current version: `v1`

API endpoints use `/v1/` prefix, with some exceptions for health, security, and admin routes

Future versions will be available at `/api/v2/`, etc.

**Base Path**: `/v1/auth`

## 🔧 Development Tools

### Swagger/OpenAPI
- **URL**: `http://localhost:4001/docs`
- **Interactive API explorer**
- **Schema documentation**

### Postman Collection
- Import collection from `/docs/postman/`
- Pre-configured environments
- Example requests for all endpoints

---

For detailed information about specific API categories, see:
- [Authentication APIs](./api-auth.md)
- [User Management APIs](./api-users.md)
- [College Management APIs](./api-colleges.md)
- [Admin APIs](./api-admin.md)
- [Internal APIs](./api-internal.md)
