/**
 * JWT Service
 * 
 * Handles JWT token generation, verification, and refresh token management.
 */

import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { randomUUID } from 'crypto';

// ============================================
// Configuration
// ============================================

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-super-secret-key-change-in-production-min-32-chars!'
);
const JWT_ISSUER = process.env.JWT_ISSUER || 'clickstudio';
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'clickstudio-client';

// Token expiration times
const ACCESS_TOKEN_EXPIRY = process.env.JWT_ACCESS_EXPIRY || '15m';
const REFRESH_TOKEN_EXPIRY = process.env.JWT_REFRESH_EXPIRY || '7d';

// ============================================
// Types
// ============================================

export interface TokenPayload extends JWTPayload {
  sub: string; // User ID
  email: string;
  username: string;
  roles: string[];
  permissions: string[];
  sessionId: string;
  type: 'access' | 'refresh';
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds
  tokenType: 'Bearer';
}

export interface DecodedToken {
  payload: TokenPayload;
  expired: boolean;
}

// ============================================
// Token Generation
// ============================================

/**
 * Generate an access token
 */
export async function generateAccessToken(payload: Omit<TokenPayload, 'type' | 'iat' | 'exp' | 'iss' | 'aud'>): Promise<string> {
  const token = await new SignJWT({ ...payload, type: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setExpirationTime(ACCESS_TOKEN_EXPIRY)
    .sign(JWT_SECRET);

  return token;
}

/**
 * Generate a refresh token
 */
export async function generateRefreshToken(userId: string, sessionId: string): Promise<string> {
  const token = await new SignJWT({ 
    sub: userId, 
    sessionId,
    type: 'refresh',
    jti: randomUUID(), // Unique token ID for revocation
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setExpirationTime(REFRESH_TOKEN_EXPIRY)
    .sign(JWT_SECRET);

  return token;
}

/**
 * Generate a token pair (access + refresh)
 */
export async function generateTokenPair(
  userId: string,
  email: string,
  username: string,
  roles: string[],
  permissions: string[],
  sessionId: string
): Promise<TokenPair> {
  const [accessToken, refreshToken] = await Promise.all([
    generateAccessToken({
      sub: userId,
      email,
      username,
      roles,
      permissions,
      sessionId,
    }),
    generateRefreshToken(userId, sessionId),
  ]);

  return {
    accessToken,
    refreshToken,
    expiresIn: parseExpiryToSeconds(ACCESS_TOKEN_EXPIRY),
    tokenType: 'Bearer',
  };
}

// ============================================
// Token Verification
// ============================================

/**
 * Verify and decode a JWT token
 */
export async function verifyToken(token: string): Promise<DecodedToken> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });

    return {
      payload: payload as TokenPayload,
      expired: false,
    };
  } catch (error) {
    // Check if token is expired
    if (error instanceof Error && error.message.includes('expired')) {
      // Decode without verification to get payload
      const parts = token.split('.');
      if (parts.length === 3) {
        try {
          const payload = JSON.parse(atob(parts[1])) as TokenPayload;
          return { payload, expired: true };
        } catch {
          throw new Error('Invalid token format');
        }
      }
    }
    throw new Error('Invalid token');
  }
}

/**
 * Verify an access token specifically
 */
export async function verifyAccessToken(token: string): Promise<TokenPayload> {
  const decoded = await verifyToken(token);
  
  if (decoded.expired) {
    throw new Error('Token expired');
  }
  
  if (decoded.payload.type !== 'access') {
    throw new Error('Invalid token type');
  }
  
  return decoded.payload;
}

/**
 * Verify a refresh token specifically
 */
export async function verifyRefreshToken(token: string): Promise<TokenPayload> {
  const decoded = await verifyToken(token);
  
  if (decoded.expired) {
    throw new Error('Refresh token expired');
  }
  
  if (decoded.payload.type !== 'refresh') {
    throw new Error('Invalid token type');
  }
  
  return decoded.payload;
}

// ============================================
// Utility Functions
// ============================================

/**
 * Parse expiry string to seconds
 */
function parseExpiryToSeconds(expiry: string): number {
  const match = expiry.match(/^(\d+)([smhd])$/);
  if (!match) return 900; // Default 15 minutes
  
  const value = parseInt(match[1], 10);
  const unit = match[2];
  
  switch (unit) {
    case 's': return value;
    case 'm': return value * 60;
    case 'h': return value * 3600;
    case 'd': return value * 86400;
    default: return 900;
  }
}

/**
 * Extract token from Authorization header
 */
export function extractTokenFromHeader(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return null;
  }
  
  return parts[1];
}

/**
 * Get token expiration date
 */
export function getTokenExpiration(token: string): Date | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const payload = JSON.parse(atob(parts[1]));
    if (!payload.exp) return null;
    
    return new Date(payload.exp * 1000);
  } catch {
    return null;
  }
}

/**
 * Check if token is about to expire (within threshold)
 */
export function isTokenExpiringSoon(token: string, thresholdSeconds: number = 300): boolean {
  const expiration = getTokenExpiration(token);
  if (!expiration) return true;
  
  const now = new Date();
  const threshold = new Date(now.getTime() + thresholdSeconds * 1000);
  
  return expiration <= threshold;
}

/**
 * Get refresh token expiry time in milliseconds
 */
export function getRefreshTokenExpiryMs(): number {
  return parseExpiryToSeconds(REFRESH_TOKEN_EXPIRY) * 1000;
}
