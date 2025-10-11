import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { env } from '../../config/env.js';

/**
 * Data Encryption Utilities for Sensitive Admin Exports
 * Implements AES-256-CBC encryption for data protection
 */

export interface EncryptionResult {
  encryptedData: Buffer;
  algorithm: string;
  iv: string;
  keyId: string;
}

export interface EncryptionMetadata {
  algorithm: string;
  iv: string;
  keyId: string;
  timestamp: string;
  dataType: string;
  recordCount?: number;
}

/**
 * Encrypt sensitive data for export
 */
export function encryptExportData(
  data: string,
  dataType: string,
  recordCount?: number
): EncryptionResult {
  const algorithm = 'aes-256-cbc';
  const key = Buffer.from(env.EXPORT_ENCRYPTION_KEY.substring(0, 32), 'utf8');
  const iv = randomBytes(16);
  
  const cipher = createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const metadata: EncryptionMetadata = {
    algorithm,
    iv: iv.toString('hex'),
    keyId: 'export-key-1',
    timestamp: new Date().toISOString(),
    dataType,
    recordCount
  };
  
  // Prepend metadata to encrypted data
  const metadataString = JSON.stringify(metadata);
  const metadataBuffer = Buffer.from(metadataString, 'utf8');
  const metadataLength = Buffer.alloc(4);
  metadataLength.writeUInt32BE(metadataBuffer.length, 0);
  
  const encryptedBuffer = Buffer.from(encrypted, 'hex');
  const finalBuffer = Buffer.concat([
    metadataLength,
    metadataBuffer,
    encryptedBuffer
  ]);
  
  return {
    encryptedData: finalBuffer,
    algorithm,
    iv: iv.toString('hex'),
    keyId: 'export-key-1'
  };
}

/**
 * Decrypt exported data (for verification/recovery)
 */
export function decryptExportData(encryptedBuffer: Buffer): {
  data: string;
  metadata: EncryptionMetadata;
} {
  // Read metadata length
  const metadataLength = encryptedBuffer.readUInt32BE(0);
  
  // Extract metadata
  const metadataBuffer = encryptedBuffer.slice(4, 4 + metadataLength);
  const metadata: EncryptionMetadata = JSON.parse(metadataBuffer.toString('utf8'));
  
  // Extract encrypted data
  const encryptedData = encryptedBuffer.slice(4 + metadataLength);
  
  // Decrypt
  const key = Buffer.from(env.EXPORT_ENCRYPTION_KEY.substring(0, 32), 'utf8');
  const iv = Buffer.from(metadata.iv, 'hex');
  const decipher = createDecipheriv(metadata.algorithm, key, iv);
  
  let decrypted = decipher.update(encryptedData.toString('hex'), 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return {
    data: decrypted,
    metadata
  };
}

/**
 * Check if export type contains sensitive data requiring encryption
 */
export function requiresEncryption(exportType: string): boolean {
  const sensitiveTypes = ['users', 'audit', 'personal_data'];
  return sensitiveTypes.includes(exportType);
}

/**
 * Generate secure filename for encrypted exports
 */
export function generateSecureFilename(
  originalFilename: string,
  encrypted: boolean,
  adminId: string
): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const randomSuffix = randomBytes(4).toString('hex');
  
  if (encrypted) {
    const baseName = originalFilename.replace(/\.[^/.]+$/, ''); // Remove extension
    return `${baseName}-encrypted-${timestamp}-${randomSuffix}.enc`;
  }
  
  return originalFilename.replace(/\.[^/.]+$/, '') + `-${timestamp}-${randomSuffix}.csv`;
}

/**
 * Validate encryption key strength
 */
export function validateEncryptionKey(): {
  valid: boolean;
  issues: string[];
  strength: 'weak' | 'medium' | 'strong';
} {
  const key = env.EXPORT_ENCRYPTION_KEY;
  const issues: string[] = [];
  
  if (!key || key.length < 32) {
    issues.push('Encryption key must be at least 32 characters long');
  }
  
  if (key === 'fallback-key-change-in-production') {
    issues.push('Using default encryption key - MUST be changed in production');
  }
  
  if (key && key.length < 64) {
    issues.push('Encryption key should be at least 64 characters for maximum security');
  }
  
  // Check for common weak patterns
  if (key && (/^(.)\1+$/.test(key) || key === '1234567890'.repeat(10))) {
    issues.push('Encryption key appears to use weak patterns');
  }
  
  let strength: 'weak' | 'medium' | 'strong' = 'strong';
  if (issues.length > 2) {
    strength = 'weak';
  } else if (issues.length > 0) {
    strength = 'medium';
  }
  
  return {
    valid: issues.length === 0,
    issues,
    strength
  };
}

/**
 * Create encryption audit log entry
 */
export function logEncryptionOperation(
  adminId: string,
  operation: 'encrypt' | 'decrypt',
  dataType: string,
  recordCount: number,
  success: boolean,
  error?: string
) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    adminId,
    operation: `DATA_${operation.toUpperCase()}`,
    dataType,
    recordCount,
    success,
    error,
    keyId: 'export-key-1',
    algorithm: 'aes-256-cbc'
  };
  
  console.log(`[ENCRYPTION_AUDIT] ${JSON.stringify(logEntry)}`);
  return logEntry;
}

/**
 * Sanitize data before encryption (remove or mask sensitive fields)
 */
export function sanitizeExportData(data: string, dataType: string): string {
  if (dataType === 'users') {
    // Remove or mask sensitive fields in user data
    const lines = data.split('\n');
    if (lines.length > 1) {
      // Assuming CSV format with headers
      const headers = lines[0].split(',');
      const sensitiveFields = ['password', 'ssn', 'phone', 'address'];
      
      const sanitizedLines = lines.map((line, index) => {
        if (index === 0) return line; // Keep headers
        
        const values = line.split(',');
        return headers.map((header, i) => {
          if (sensitiveFields.some(field => header.toLowerCase().includes(field))) {
            return '[REDACTED]';
          }
          return values[i] || '';
        }).join(',');
      });
      
      return sanitizedLines.join('\n');
    }
  }
  
  return data;
}

/**
 * Compress data before encryption (for large exports)
 */
export function compressData(data: string): Buffer {
  const zlib = require('zlib');
  return zlib.gzipSync(Buffer.from(data, 'utf8'));
}

/**
 * Decompress data after decryption
 */
export function decompressData(compressedData: Buffer): string {
  const zlib = require('zlib');
  return zlib.gunzipSync(compressedData).toString('utf8');
}
