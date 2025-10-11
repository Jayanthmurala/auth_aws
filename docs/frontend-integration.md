# Frontend Integration Guide

## 🌐 CORS Configuration & Frontend Integration

This guide covers how to integrate the Nexus Auth Service with frontend applications, handle CORS properly, and implement authentication flows.

---

## 🔧 CORS Setup

### Backend Configuration

The auth service uses `@fastify/cors` with environment-based configuration:

```typescript
// src/index.ts
await app.register(cors, {
  origin: env.FRONTEND_URLS.split(',').map(url => url.trim()),
  credentials: true,
  allowedHeaders: ["Authorization", "Content-Type", "X-Request-ID"],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
});
```

### Environment Variables

```bash
# .env
FRONTEND_URLS="http://localhost:3000,http://127.0.0.1:3000,https://app.nexus.edu"
```

### Preflight Requests

The service automatically handles OPTIONS preflight requests for:
- `Authorization` header
- `Content-Type: application/json`
- Custom headers like `X-Request-ID`

---

## 🔐 Authentication Flow Implementation

### 1. Login Flow

```javascript
// Frontend login implementation
class AuthService {
  constructor() {
    this.baseURL = 'http://localhost:4001';
    this.accessToken = localStorage.getItem('accessToken');
    this.refreshToken = localStorage.getItem('refreshToken');
  }

  async login(email, password) {
    try {
      const response = await fetch(`${this.baseURL}/v1/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include', // Important for CORS
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || 'Login failed');
      }

      // Handle MFA if required
      if (data.data.mfaRequired) {
        return {
          mfaRequired: true,
          mfaToken: data.data.mfaToken,
          availableMethods: data.data.availableMethods
        };
      }

      // Store tokens
      this.setTokens(data.data.tokens);
      return { success: true, user: data.data.user };

    } catch (error) {
      console.error('Login error:', error);
      throw error;
    }
  }

  async completeMFA(mfaToken, code, method = 'totp') {
    const response = await fetch(`${this.baseURL}/v1/auth/mfa/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify({ mfaToken, code, method })
    });

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error?.message || 'MFA verification failed');
    }

    this.setTokens(data.data.tokens);
    return { success: true, user: data.data.user };
  }

  setTokens(tokens) {
    this.accessToken = tokens.accessToken;
    this.refreshToken = tokens.refreshToken;
    
    localStorage.setItem('accessToken', tokens.accessToken);
    localStorage.setItem('refreshToken', tokens.refreshToken);
    
    // Set expiration time
    const expiresAt = Date.now() + (tokens.expiresIn * 1000);
    localStorage.setItem('tokenExpiresAt', expiresAt.toString());
  }
}
```

### 2. Automatic Token Refresh

```javascript
class AuthService {
  async refreshAccessToken() {
    if (!this.refreshToken) {
      throw new Error('No refresh token available');
    }

    try {
      const response = await fetch(`${this.baseURL}/v1/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ refreshToken: this.refreshToken })
      });

      const data = await response.json();

      if (!response.ok) {
        // Refresh token expired, redirect to login
        this.logout();
        throw new Error('Session expired');
      }

      this.setTokens(data.data);
      return data.data.accessToken;

    } catch (error) {
      this.logout();
      throw error;
    }
  }

  async makeAuthenticatedRequest(url, options = {}) {
    // Check if token is expired
    const expiresAt = localStorage.getItem('tokenExpiresAt');
    if (expiresAt && Date.now() > parseInt(expiresAt) - 60000) { // Refresh 1 minute before expiry
      await this.refreshAccessToken();
    }

    let response = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json'
      },
      credentials: 'include'
    });

    // Handle token expiration
    if (response.status === 401) {
      try {
        await this.refreshAccessToken();
        // Retry request with new token
        response = await fetch(url, {
          ...options,
          headers: {
            ...options.headers,
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          },
          credentials: 'include'
        });
      } catch (refreshError) {
        // Refresh failed, redirect to login
        window.location.href = '/login';
        throw refreshError;
      }
    }

    return response;
  }

  logout() {
    // Clear tokens
    this.accessToken = null;
    this.refreshToken = null;
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('tokenExpiresAt');

    // Optional: Call logout endpoint
    if (this.refreshToken) {
      fetch(`${this.baseURL}/v1/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ refreshToken: this.refreshToken })
      }).catch(() => {}); // Ignore errors
    }
  }
}
```

---

## ⚛️ React Integration

### 1. Auth Context Provider

```jsx
// contexts/AuthContext.js
import React, { createContext, useContext, useReducer, useEffect } from 'react';

const AuthContext = createContext();

const authReducer = (state, action) => {
  switch (action.type) {
    case 'LOGIN_START':
      return { ...state, loading: true, error: null };
    case 'LOGIN_SUCCESS':
      return { 
        ...state, 
        loading: false, 
        user: action.payload.user, 
        isAuthenticated: true 
      };
    case 'LOGIN_ERROR':
      return { ...state, loading: false, error: action.payload };
    case 'LOGOUT':
      return { ...state, user: null, isAuthenticated: false };
    case 'MFA_REQUIRED':
      return { 
        ...state, 
        loading: false, 
        mfaRequired: true, 
        mfaToken: action.payload.mfaToken 
      };
    default:
      return state;
  }
};

export const AuthProvider = ({ children }) => {
  const [state, dispatch] = useReducer(authReducer, {
    user: null,
    isAuthenticated: false,
    loading: false,
    error: null,
    mfaRequired: false,
    mfaToken: null
  });

  const authService = new AuthService();

  const login = async (email, password) => {
    dispatch({ type: 'LOGIN_START' });
    
    try {
      const result = await authService.login(email, password);
      
      if (result.mfaRequired) {
        dispatch({ 
          type: 'MFA_REQUIRED', 
          payload: { mfaToken: result.mfaToken } 
        });
      } else {
        dispatch({ 
          type: 'LOGIN_SUCCESS', 
          payload: { user: result.user } 
        });
      }
    } catch (error) {
      dispatch({ 
        type: 'LOGIN_ERROR', 
        payload: error.message 
      });
    }
  };

  const completeMFA = async (code, method = 'totp') => {
    try {
      const result = await authService.completeMFA(state.mfaToken, code, method);
      dispatch({ 
        type: 'LOGIN_SUCCESS', 
        payload: { user: result.user } 
      });
    } catch (error) {
      dispatch({ 
        type: 'LOGIN_ERROR', 
        payload: error.message 
      });
    }
  };

  const logout = () => {
    authService.logout();
    dispatch({ type: 'LOGOUT' });
  };

  // Check for existing session on mount
  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (token) {
      // Verify token and get user info
      authService.makeAuthenticatedRequest('/v1/auth/me')
        .then(response => response.json())
        .then(data => {
          if (data.success) {
            dispatch({ 
              type: 'LOGIN_SUCCESS', 
              payload: { user: data.data.user } 
            });
          }
        })
        .catch(() => {
          // Token invalid, clear storage
          authService.logout();
        });
    }
  }, []);

  return (
    <AuthContext.Provider value={{
      ...state,
      login,
      logout,
      completeMFA,
      authService
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
```

### 2. Login Component

```jsx
// components/LoginForm.js
import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

const LoginForm = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const { login, completeMFA, loading, error, mfaRequired } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (mfaRequired) {
      await completeMFA(mfaCode);
    } else {
      await login(email, password);
    }
  };

  if (mfaRequired) {
    return (
      <form onSubmit={handleSubmit}>
        <h2>Multi-Factor Authentication</h2>
        <div>
          <label>Enter your authentication code:</label>
          <input
            type="text"
            value={mfaCode}
            onChange={(e) => setMfaCode(e.target.value)}
            placeholder="123456"
            maxLength={6}
            required
          />
        </div>
        <button type="submit" disabled={loading}>
          {loading ? 'Verifying...' : 'Verify'}
        </button>
        {error && <div className="error">{error}</div>}
      </form>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <h2>Login</h2>
      <div>
        <label>Email:</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <div>
        <label>Password:</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      <button type="submit" disabled={loading}>
        {loading ? 'Logging in...' : 'Login'}
      </button>
      {error && <div className="error">{error}</div>}
    </form>
  );
};

export default LoginForm;
```

### 3. Protected Route Component

```jsx
// components/ProtectedRoute.js
import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const ProtectedRoute = ({ children, requiredRole = null }) => {
  const { isAuthenticated, user, loading } = useAuth();

  if (loading) {
    return <div>Loading...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (requiredRole && user.role !== requiredRole) {
    return <Navigate to="/unauthorized" replace />;
  }

  return children;
};

export default ProtectedRoute;
```

---

## 🔧 API Integration Hooks

### Custom React Hooks

```jsx
// hooks/useApi.js
import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

export const useApi = (url, options = {}) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { authService } = useAuth();

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const response = await authService.makeAuthenticatedRequest(url, options);
        const result = await response.json();
        
        if (!response.ok) {
          throw new Error(result.error?.message || 'Request failed');
        }
        
        setData(result.data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [url]);

  return { data, loading, error };
};

// hooks/useProfile.js
export const useProfile = () => {
  const { data, loading, error } = useApi('/v1/auth/me');
  
  return {
    user: data?.user,
    permissions: data?.permissions,
    loading,
    error
  };
};

// hooks/useUsers.js
export const useUsers = (page = 1, limit = 20) => {
  const { data, loading, error } = useApi(`/v1/users?page=${page}&limit=${limit}`);
  
  return {
    users: data?.items || [],
    pagination: data?.pagination,
    loading,
    error
  };
};
```

---

## 🌐 CORS Troubleshooting

### Common CORS Issues

#### 1. Origin Not Allowed
```
Access to fetch at 'http://localhost:4001/v1/auth/login' from origin 'http://localhost:3001' has been blocked by CORS policy
```

**Solution**: Add your frontend URL to `FRONTEND_URLS`:
```bash
FRONTEND_URLS="http://localhost:3000,http://localhost:3001"
```

#### 2. Credentials Not Allowed
```
Access to fetch has been blocked by CORS policy: The value of the 'Access-Control-Allow-Credentials' header is '' which must be 'true'
```

**Solution**: Ensure `credentials: 'include'` in fetch requests:
```javascript
fetch(url, {
  credentials: 'include', // This is required
  headers: { ... }
})
```

#### 3. Preflight Request Failed
```
Access to fetch has been blocked by CORS policy: Response to preflight request doesn't pass access control check
```

**Solution**: Check allowed headers in backend configuration:
```typescript
allowedHeaders: ["Authorization", "Content-Type", "X-Request-ID"]
```

### CORS Testing

```bash
# Test preflight request
curl -X OPTIONS http://localhost:4001/v1/auth/login \
  -H "Origin: http://localhost:3000" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type,Authorization"

# Expected response headers:
# Access-Control-Allow-Origin: http://localhost:3000
# Access-Control-Allow-Methods: GET,POST,PUT,DELETE,OPTIONS
# Access-Control-Allow-Headers: Authorization,Content-Type
# Access-Control-Allow-Credentials: true
```

---

## 📱 Mobile App Integration

### React Native Example

```javascript
// services/AuthService.js (React Native)
import AsyncStorage from '@react-native-async-storage/async-storage';

class AuthService {
  constructor() {
    this.baseURL = 'https://api.nexus.edu';
  }

  async login(email, password) {
    const response = await fetch(`${this.baseURL}/v1/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();

    if (data.success && !data.data.mfaRequired) {
      await AsyncStorage.setItem('accessToken', data.data.tokens.accessToken);
      await AsyncStorage.setItem('refreshToken', data.data.tokens.refreshToken);
    }

    return data;
  }

  async makeAuthenticatedRequest(url, options = {}) {
    const token = await AsyncStorage.getItem('accessToken');
    
    return fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
  }
}
```

---

## 🔒 Security Best Practices

### Frontend Security

1. **Token Storage**
   ```javascript
   // ✅ Good: Use httpOnly cookies (if possible)
   // ✅ Acceptable: localStorage for SPA
   // ❌ Bad: sessionStorage for long-lived tokens
   ```

2. **HTTPS Only**
   ```javascript
   // Always use HTTPS in production
   const baseURL = process.env.NODE_ENV === 'production' 
     ? 'https://api.nexus.edu' 
     : 'http://localhost:4001';
   ```

3. **Token Validation**
   ```javascript
   // Validate token before making requests
   const isTokenValid = () => {
     const expiresAt = localStorage.getItem('tokenExpiresAt');
     return expiresAt && Date.now() < parseInt(expiresAt);
   };
   ```

4. **Error Handling**
   ```javascript
   // Don't expose sensitive error details
   const handleAuthError = (error) => {
     if (error.status === 401) {
       // Token expired or invalid
       logout();
       redirect('/login');
     } else {
       // Generic error message
       showError('Something went wrong. Please try again.');
     }
   };
   ```

---

## 📊 Environment-Specific Configuration

### Development
```javascript
// config/development.js
export const config = {
  apiBaseURL: 'http://localhost:4001',
  enableDebugLogs: true,
  tokenRefreshBuffer: 60000, // 1 minute
};
```

### Production
```javascript
// config/production.js
export const config = {
  apiBaseURL: 'https://api.nexus.edu',
  enableDebugLogs: false,
  tokenRefreshBuffer: 300000, // 5 minutes
};
```

### Usage
```javascript
import { config } from './config';

const authService = new AuthService(config.apiBaseURL);
```

---

## 🧪 Testing Frontend Integration

### Unit Tests

```javascript
// __tests__/AuthService.test.js
import { AuthService } from '../services/AuthService';

// Mock fetch
global.fetch = jest.fn();

describe('AuthService', () => {
  beforeEach(() => {
    fetch.mockClear();
  });

  test('login success', async () => {
    const mockResponse = {
      success: true,
      data: {
        user: { id: '1', email: 'test@example.com' },
        tokens: { accessToken: 'token123', refreshToken: 'refresh123' }
      }
    };

    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse
    });

    const authService = new AuthService();
    const result = await authService.login('test@example.com', 'password');

    expect(result.success).toBe(true);
    expect(result.user.email).toBe('test@example.com');
  });

  test('login with MFA', async () => {
    const mockResponse = {
      success: true,
      data: {
        mfaRequired: true,
        mfaToken: 'mfa-token-123'
      }
    };

    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse
    });

    const authService = new AuthService();
    const result = await authService.login('test@example.com', 'password');

    expect(result.mfaRequired).toBe(true);
    expect(result.mfaToken).toBe('mfa-token-123');
  });
});
```

### Integration Tests

```javascript
// cypress/integration/auth.spec.js
describe('Authentication Flow', () => {
  it('should login successfully', () => {
    cy.visit('/login');
    cy.get('[data-testid=email]').type('test@example.com');
    cy.get('[data-testid=password]').type('password123');
    cy.get('[data-testid=login-button]').click();
    
    cy.url().should('include', '/dashboard');
    cy.get('[data-testid=user-menu]').should('be.visible');
  });

  it('should handle MFA flow', () => {
    cy.intercept('POST', '/api/v1/auth/login', {
      fixture: 'mfa-required-response.json'
    });

    cy.visit('/login');
    cy.get('[data-testid=email]').type('mfa-user@example.com');
    cy.get('[data-testid=password]').type('password123');
    cy.get('[data-testid=login-button]').click();

    cy.get('[data-testid=mfa-code]').should('be.visible');
    cy.get('[data-testid=mfa-code]').type('123456');
    cy.get('[data-testid=verify-button]').click();

    cy.url().should('include', '/dashboard');
  });
});
```

---

For more information, see:
- [API Overview](./api-overview.md)
- [Authentication APIs](./api-auth.md)
- [Troubleshooting Guide](./troubleshooting.md)
- [Security Guide](./security.md)
