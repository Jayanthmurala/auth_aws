import { randomBytes, createHash } from 'crypto';
import { Role } from '@prisma/client';
import { RedisManager } from '../config/redis.js';
import { env } from '../config/env.js';
import { prisma } from '../db.js';
import { AuditLogger } from '../middleware/auditLogger.js';
import { signAccessToken } from '../utils/jwt.js';

/**
 * Single Sign-On (SSO) Service
 * Supports SAML 2.0, OAuth2/OIDC, and enterprise identity providers
 */

export interface SSOProvider {
  id: string;
  name: string;
  type: 'saml' | 'oauth2' | 'oidc';
  enabled: boolean;
  config: {
    // SAML Configuration
    entityId?: string;
    ssoUrl?: string;
    x509Certificate?: string;
    
    // OAuth2/OIDC Configuration
    clientId?: string;
    clientSecret?: string;
    authorizationUrl?: string;
    tokenUrl?: string;
    userInfoUrl?: string;
    scope?: string[];
    
    // Common Configuration
    attributeMapping?: {
      email: string;
      firstName?: string;
      lastName?: string;
      displayName?: string;
      roles?: string;
      department?: string;
    };
    
    // Auto-provisioning
    autoProvision?: boolean;
    defaultRoles?: string[];
    allowedDomains?: string[];
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface SSOSession {
  id: string;
  providerId: string;
  userId?: string;
  state: string;
  nonce?: string;
  redirectUrl: string;
  expiresAt: Date;
  metadata?: Record<string, any>;
}

export interface SSOUserProfile {
  providerId: string;
  providerUserId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  roles?: string[];
  department?: string;
  attributes?: Record<string, any>;
}

export class SSOService {
  private static providers = new Map<string, SSOProvider>();

  /**
   * Initialize SSO service with providers
   */
  static async initialize(providers: SSOProvider[] = []): Promise<void> {
    // Load providers from database or configuration
    for (const provider of providers) {
      this.providers.set(provider.id, provider);
    }

    // Load default providers for common enterprise systems
    await this.loadDefaultProviders();

    console.log(`[SSO Service] Initialized with ${this.providers.size} providers`);
  }

  /**
   * Get all SSO providers
   */
  static getProviders(): SSOProvider[] {
    return Array.from(this.providers.values()).filter(p => p.enabled);
  }

  /**
   * Get SSO provider by ID
   */
  static getProvider(providerId: string): SSOProvider | null {
    return this.providers.get(providerId) || null;
  }

  /**
   * Initiate SSO login
   */
  static async initiateSSOLogin(providerId: string, redirectUrl: string): Promise<{
    authUrl: string;
    sessionId: string;
  }> {
    const provider = this.getProvider(providerId);
    if (!provider || !provider.enabled) {
      throw new Error('SSO provider not found or disabled');
    }

    const sessionId = `sso-${providerId}-${Date.now()}-${randomBytes(8).toString('hex')}`;
    const state = randomBytes(32).toString('hex');
    const nonce = randomBytes(16).toString('hex');

    // Create SSO session
    const session: SSOSession = {
      id: sessionId,
      providerId,
      state,
      nonce,
      redirectUrl,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
      metadata: {}
    };

    await this.storeSession(session);

    // Generate authorization URL based on provider type
    let authUrl: string;
    
    switch (provider.type) {
      case 'oauth2':
      case 'oidc':
        authUrl = this.buildOAuth2AuthUrl(provider, state, nonce, redirectUrl);
        break;
      case 'saml':
        authUrl = this.buildSAMLAuthUrl(provider, sessionId);
        break;
      default:
        throw new Error(`Unsupported SSO provider type: ${provider.type}`);
    }

    // Audit log SSO initiation
    AuditLogger.logSystem('sso_login_initiated', `/sso/${providerId}/login`, {
      details: { providerId, sessionId, providerType: provider.type },
      risk: 'medium',
      category: 'auth'
    });

    return { authUrl, sessionId };
  }

  /**
   * Handle OAuth2/OIDC callback
   */
  static async handleOAuth2Callback(
    providerId: string,
    code: string,
    state: string
  ): Promise<{
    success: boolean;
    user?: any;
    token?: string;
    error?: string;
  }> {
    try {
      const provider = this.getProvider(providerId);
      if (!provider || provider.type !== 'oauth2' && provider.type !== 'oidc') {
        throw new Error('Invalid OAuth2/OIDC provider');
      }

      // Verify state parameter
      const session = await this.getSessionByState(state);
      if (!session || session.providerId !== providerId) {
        throw new Error('Invalid or expired SSO session');
      }

      // Exchange code for tokens
      const tokens = await this.exchangeCodeForTokens(provider, code, session.redirectUrl);
      
      // Get user profile
      const profile = await this.getUserProfile(provider, tokens.accessToken);
      
      // Find or create user
      const user = await this.findOrCreateUser(profile, provider);
      
      // Generate JWT token
      const jwtToken = await signAccessToken(user.id, {
        email: user.email,
        displayName: user.displayName,
        roles: user.roles,
        ssoProvider: providerId
      });

      // Update session with user info
      session.userId = user.id;
      await this.storeSession(session);

      // Audit log successful SSO login
      AuditLogger.logSystem('sso_login_success', `/sso/${providerId}/callback`, {
        details: { 
          providerId, 
          userId: user.id, 
          email: user.email,
          sessionId: session.id 
        },
        risk: 'medium',
        category: 'auth'
      });

      return {
        success: true,
        user,
        token: jwtToken
      };
    } catch (error) {
      // Audit log SSO failure
      AuditLogger.logSystem('sso_login_failed', `/sso/${providerId}/callback`, {
        details: { 
          providerId, 
          error: error instanceof Error ? error.message : 'Unknown error',
          state 
        },
        risk: 'high',
        category: 'auth'
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'SSO authentication failed'
      };
    }
  }

  /**
   * Handle SAML response
   */
  static async handleSAMLResponse(
    providerId: string,
    samlResponse: string,
    sessionId: string
  ): Promise<{
    success: boolean;
    user?: any;
    token?: string;
    error?: string;
  }> {
    try {
      const provider = this.getProvider(providerId);
      if (!provider || provider.type !== 'saml') {
        throw new Error('Invalid SAML provider');
      }

      const session = await this.getSession(sessionId);
      if (!session || session.providerId !== providerId) {
        throw new Error('Invalid or expired SAML session');
      }

      // Parse and validate SAML response
      const profile = await this.parseSAMLResponse(samlResponse, provider);
      
      // Find or create user
      const user = await this.findOrCreateUser(profile, provider);
      
      // Generate JWT token
      const jwtToken = await signAccessToken(user.id, {
        email: user.email,
        displayName: user.displayName,
        roles: user.roles,
        ssoProvider: providerId
      });

      // Update session
      session.userId = user.id;
      await this.storeSession(session);

      // Audit log successful SAML login
      AuditLogger.logSystem('saml_login_success', `/sso/${providerId}/acs`, {
        details: { 
          providerId, 
          userId: user.id, 
          email: user.email,
          sessionId 
        },
        risk: 'medium',
        category: 'auth'
      });

      return {
        success: true,
        user,
        token: jwtToken
      };
    } catch (error) {
      // Audit log SAML failure
      AuditLogger.logSystem('saml_login_failed', `/sso/${providerId}/acs`, {
        details: { 
          providerId, 
          error: error instanceof Error ? error.message : 'Unknown error',
          sessionId 
        },
        risk: 'high',
        category: 'auth'
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'SAML authentication failed'
      };
    }
  }

  /**
   * Create or update SSO provider
   */
  static async createProvider(provider: Omit<SSOProvider, 'id' | 'createdAt' | 'updatedAt'>): Promise<SSOProvider> {
    const newProvider: SSOProvider = {
      id: `sso-${provider.type}-${Date.now()}`,
      ...provider,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.providers.set(newProvider.id, newProvider);
    
    // TODO: Store in database
    
    // Audit log provider creation
    AuditLogger.logSystem('sso_provider_created', `/admin/sso/providers`, {
      details: { providerId: newProvider.id, providerName: newProvider.name, type: newProvider.type },
      risk: 'high',
      category: 'admin'
    });

    return newProvider;
  }

  /**
   * Get SSO statistics
   */
  static async getStats(): Promise<{
    totalProviders: number;
    enabledProviders: number;
    providerTypes: Record<string, number>;
    totalSSOLogins: number;
    recentLogins: number;
  }> {
    const providers = Array.from(this.providers.values());
    
    return {
      totalProviders: providers.length,
      enabledProviders: providers.filter(p => p.enabled).length,
      providerTypes: providers.reduce((acc, p) => {
        acc[p.type] = (acc[p.type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      totalSSOLogins: 0, // TODO: Implement from audit logs
      recentLogins: 0    // TODO: Implement from audit logs
    };
  }

  /**
   * Private helper methods
   */
  private static async loadDefaultProviders(): Promise<void> {
    // Google Workspace (OAuth2/OIDC)
    const googleProvider: SSOProvider = {
      id: 'google-workspace',
      name: 'Google Workspace',
      type: 'oidc',
      enabled: false, // Disabled by default, admin must configure
      config: {
        clientId: '',
        clientSecret: '',
        authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
        scope: ['openid', 'email', 'profile'],
        attributeMapping: {
          email: 'email',
          firstName: 'given_name',
          lastName: 'family_name',
          displayName: 'name'
        },
        autoProvision: true,
        defaultRoles: ['STUDENT']
      },
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Microsoft Azure AD (OAuth2/OIDC)
    const azureProvider: SSOProvider = {
      id: 'azure-ad',
      name: 'Microsoft Azure AD',
      type: 'oidc',
      enabled: false,
      config: {
        clientId: '',
        clientSecret: '',
        authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
        tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        userInfoUrl: 'https://graph.microsoft.com/v1.0/me',
        scope: ['openid', 'email', 'profile'],
        attributeMapping: {
          email: 'mail',
          firstName: 'givenName',
          lastName: 'surname',
          displayName: 'displayName'
        },
        autoProvision: true,
        defaultRoles: ['STUDENT']
      },
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.providers.set(googleProvider.id, googleProvider);
    this.providers.set(azureProvider.id, azureProvider);
  }

  private static buildOAuth2AuthUrl(provider: SSOProvider, state: string, nonce: string, redirectUrl: string): string {
    const params = new URLSearchParams({
      client_id: provider.config.clientId!,
      response_type: 'code',
      scope: provider.config.scope?.join(' ') || 'openid email profile',
      redirect_uri: `${env.FRONTEND_URL}/auth/sso/${provider.id}/callback`,
      state,
      ...(provider.type === 'oidc' && { nonce })
    });

    return `${provider.config.authorizationUrl}?${params.toString()}`;
  }

  private static buildSAMLAuthUrl(provider: SSOProvider, sessionId: string): string {
    // TODO: Implement SAML AuthnRequest generation
    return `${provider.config.ssoUrl}?SAMLRequest=...&RelayState=${sessionId}`;
  }

  private static async exchangeCodeForTokens(provider: SSOProvider, code: string, redirectUrl: string): Promise<{
    accessToken: string;
    idToken?: string;
    refreshToken?: string;
  }> {
    // TODO: Implement OAuth2 token exchange
    return {
      accessToken: 'mock-access-token',
      idToken: 'mock-id-token'
    };
  }

  private static async getUserProfile(provider: SSOProvider, accessToken: string): Promise<SSOUserProfile> {
    // TODO: Implement user profile retrieval from provider
    return {
      providerId: provider.id,
      providerUserId: 'mock-user-id',
      email: 'user@example.com',
      displayName: 'Mock User'
    };
  }

  private static async parseSAMLResponse(samlResponse: string, provider: SSOProvider): Promise<SSOUserProfile> {
    // TODO: Implement SAML response parsing and validation
    return {
      providerId: provider.id,
      providerUserId: 'mock-saml-user',
      email: 'saml-user@example.com',
      displayName: 'SAML User'
    };
  }

  private static async findOrCreateUser(profile: SSOUserProfile, provider: SSOProvider): Promise<any> {
    // Check if user exists by email
    let user = await prisma.user.findUnique({
      where: { email: profile.email }
    });

    // SECURITY: Auto-provisioning disabled for security reasons
    // Users must be created by administrators only
    if (!user) {
      // Log the attempt for security monitoring
      AuditLogger.logSystem('sso_user_not_found', `/sso/${provider.id}/login`, {
        details: { 
          email: profile.email.substring(0, 3) + '***', // Partial email for privacy
          providerId: provider.id,
          reason: 'User not found in database - auto-provisioning disabled'
        },
        risk: 'medium',
        category: 'auth'
      });
      
      throw new Error('User not found. Contact your administrator to create an account.');
    }

    // Verify user is active
    if (user.status !== 'ACTIVE' || user.deletedAt) {
      AuditLogger.logSystem('sso_inactive_user_attempt', `/sso/${provider.id}/login`, {
        details: { 
          userId: user.id,
          status: user.status,
          providerId: provider.id 
        },
        risk: 'medium',
        category: 'auth'
      });
      
      throw new Error('Account is not active. Contact your administrator.');
    }

    return user;
  }

  private static async storeSession(session: SSOSession): Promise<void> {
    if (env.REDIS_DISABLED) return;

    try {
      const redis = RedisManager.getInstance();
      const key = `sso:session:${session.id}`;
      
      await redis.setex(key, 600, JSON.stringify({
        ...session,
        expiresAt: session.expiresAt.toISOString()
      })); // Store for 10 minutes
    } catch (error) {
      console.error('[SSO Service] Error storing session:', error);
    }
  }

  private static async getSession(sessionId: string): Promise<SSOSession | null> {
    if (env.REDIS_DISABLED) return null;

    try {
      const redis = RedisManager.getInstance();
      const key = `sso:session:${sessionId}`;
      const sessionData = await redis.get(key);
      
      if (!sessionData) return null;
      
      const session = JSON.parse(sessionData);
      return {
        ...session,
        expiresAt: new Date(session.expiresAt)
      };
    } catch (error) {
      console.error('[SSO Service] Error getting session:', error);
      return null;
    }
  }

  private static async getSessionByState(state: string): Promise<SSOSession | null> {
    if (env.REDIS_DISABLED) return null;

    try {
      const redis = RedisManager.getInstance();
      const sessionKeys = await redis.keys('sso:session:*');
      
      for (const key of sessionKeys) {
        const sessionData = await redis.get(key);
        if (sessionData) {
          const session = JSON.parse(sessionData);
          if (session.state === state) {
            return {
              ...session,
              expiresAt: new Date(session.expiresAt)
            };
          }
        }
      }
      
      return null;
    } catch (error) {
      console.error('[SSO Service] Error finding session by state:', error);
      return null;
    }
  }
}
