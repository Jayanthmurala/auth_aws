import { Logger } from './logger.js';

/**
 * Enhanced password complexity validation for production security
 */

export interface PasswordValidationResult {
  isValid: boolean;
  score: number; // 0-100
  errors: string[];
  warnings: string[];
  suggestions: string[];
}

export interface PasswordPolicy {
  minLength: number;
  maxLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumbers: boolean;
  requireSpecialChars: boolean;
  minSpecialChars: number;
  preventCommonPasswords: boolean;
  preventUserInfo: boolean;
  preventSequential: boolean;
  preventRepeating: boolean;
  maxRepeatingChars: number;
}

// Default production-ready password policy
export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 12,
  maxLength: 128,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: true,
  minSpecialChars: 1,
  preventCommonPasswords: true,
  preventUserInfo: true,
  preventSequential: true,
  preventRepeating: true,
  maxRepeatingChars: 2
};

// Common weak passwords (subset - in production, use a comprehensive list)
const COMMON_PASSWORDS = new Set([
  'password', 'password123', '123456', '123456789', 'qwerty', 'abc123',
  'password1', 'admin', 'letmein', 'welcome', 'monkey', '1234567890',
  'dragon', 'master', 'hello', 'freedom', 'whatever', 'qazwsx',
  'trustno1', 'jordan23', 'harley', 'robert', 'matthew', 'jordan',
  'michelle', 'daniel', 'andrew', 'joshua', 'hunter', 'changeme',
  'fuckme', 'fuckyou', 'soccer', 'batman', 'secret', 'love',
  'sex', 'god', 'michael', 'jennifer', 'hunter2', 'tigger',
  'pussy', 'killer', 'hockey', 'george', 'sexy', 'andrew',
  'charlie', 'superman', 'asshole', 'fuckit', 'dallas', 'jessica',
  'panties', 'pepper', ' 1111', '1234', '12345', '696969', 'mustang',
  'shadow', 'master', 'jennifer', 'jordan', 'superman', 'harley'
]);

// Common keyboard patterns
const KEYBOARD_PATTERNS = [
  'qwerty', 'qwertyuiop', 'asdf', 'asdfgh', 'asdfghjkl', 'zxcv', 'zxcvbn', 'zxcvbnm',
  '1234', '12345', '123456', '1234567', '12345678', '123456789', '1234567890',
  'abcd', 'abcde', 'abcdef', 'abcdefg', 'abcdefgh', 'abcdefghi', 'abcdefghij'
];

/**
 * Check if password contains sequential characters
 */
function hasSequentialChars(password: string, maxLength: number = 3): boolean {
  const lower = password.toLowerCase();
  
  // Check for sequential letters
  for (let i = 0; i <= lower.length - maxLength; i++) {
    let isSequential = true;
    for (let j = 1; j < maxLength; j++) {
      if (lower.charCodeAt(i + j) !== lower.charCodeAt(i + j - 1) + 1) {
        isSequential = false;
        break;
      }
    }
    if (isSequential) return true;
  }
  
  // Check for sequential numbers
  for (let i = 0; i <= password.length - maxLength; i++) {
    let isSequential = true;
    const firstChar = password.charCodeAt(i);
    if (firstChar >= 48 && firstChar <= 57) { // 0-9
      for (let j = 1; j < maxLength; j++) {
        if (password.charCodeAt(i + j) !== firstChar + j) {
          isSequential = false;
          break;
        }
      }
      if (isSequential) return true;
    }
  }
  
  return false;
}

/**
 * Check if password has too many repeating characters
 */
function hasRepeatingChars(password: string, maxRepeating: number): boolean {
  let count = 1;
  for (let i = 1; i < password.length; i++) {
    if (password[i] === password[i - 1]) {
      count++;
      if (count > maxRepeating) return true;
    } else {
      count = 1;
    }
  }
  return false;
}

/**
 * Check if password contains keyboard patterns
 */
function hasKeyboardPatterns(password: string): boolean {
  const lower = password.toLowerCase();
  return KEYBOARD_PATTERNS.some(pattern => 
    lower.includes(pattern) || lower.includes(pattern.split('').reverse().join(''))
  );
}

/**
 * Check if password contains user information
 */
function containsUserInfo(password: string, userInfo: {
  email?: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
}): boolean {
  const lower = password.toLowerCase();
  
  if (userInfo.email) {
    const emailParts = userInfo.email.toLowerCase().split('@');
    if (emailParts[0] && lower.includes(emailParts[0])) return true;
    if (emailParts[1] && lower.includes(emailParts[1].split('.')[0])) return true;
  }
  
  if (userInfo.displayName && lower.includes(userInfo.displayName.toLowerCase())) return true;
  if (userInfo.firstName && lower.includes(userInfo.firstName.toLowerCase())) return true;
  if (userInfo.lastName && lower.includes(userInfo.lastName.toLowerCase())) return true;
  
  return false;
}

/**
 * Calculate password entropy (bits)
 */
function calculateEntropy(password: string): number {
  let charsetSize = 0;
  
  if (/[a-z]/.test(password)) charsetSize += 26;
  if (/[A-Z]/.test(password)) charsetSize += 26;
  if (/[0-9]/.test(password)) charsetSize += 10;
  if (/[^a-zA-Z0-9]/.test(password)) charsetSize += 32; // Approximate special chars
  
  return Math.log2(Math.pow(charsetSize, password.length));
}

/**
 * Comprehensive password validation
 */
export function validatePassword(
  password: string, 
  policy: PasswordPolicy = DEFAULT_PASSWORD_POLICY,
  userInfo?: {
    email?: string;
    displayName?: string;
    firstName?: string;
    lastName?: string;
  }
): PasswordValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const suggestions: string[] = [];
  let score = 0;

  // Length validation
  if (password.length < policy.minLength) {
    errors.push(`Password must be at least ${policy.minLength} characters long`);
  } else {
    score += Math.min(25, (password.length / policy.minLength) * 25);
  }

  if (password.length > policy.maxLength) {
    errors.push(`Password must not exceed ${policy.maxLength} characters`);
  }

  // Character type requirements
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumbers = /[0-9]/.test(password);
  const hasSpecial = /[^a-zA-Z0-9]/.test(password);
  const specialCharCount = (password.match(/[^a-zA-Z0-9]/g) || []).length;

  if (policy.requireUppercase && !hasUpper) {
    errors.push('Password must contain at least one uppercase letter');
  } else if (hasUpper) {
    score += 15;
  }

  if (policy.requireLowercase && !hasLower) {
    errors.push('Password must contain at least one lowercase letter');
  } else if (hasLower) {
    score += 15;
  }

  if (policy.requireNumbers && !hasNumbers) {
    errors.push('Password must contain at least one number');
  } else if (hasNumbers) {
    score += 15;
  }

  if (policy.requireSpecialChars && !hasSpecial) {
    errors.push('Password must contain at least one special character (!@#$%^&*()_+-=[]{}|;:,.<>?)');
  } else if (hasSpecial) {
    score += 15;
  }

  if (policy.requireSpecialChars && specialCharCount < policy.minSpecialChars) {
    errors.push(`Password must contain at least ${policy.minSpecialChars} special characters`);
  }

  // Common password check
  if (policy.preventCommonPasswords && COMMON_PASSWORDS.has(password.toLowerCase())) {
    errors.push('Password is too common and easily guessable');
    score -= 30;
  }

  // User information check
  if (policy.preventUserInfo && userInfo && containsUserInfo(password, userInfo)) {
    errors.push('Password must not contain personal information');
    score -= 20;
  }

  // Sequential characters check
  if (policy.preventSequential && hasSequentialChars(password)) {
    warnings.push('Password contains sequential characters which reduces security');
    score -= 10;
  }

  // Repeating characters check
  if (policy.preventRepeating && hasRepeatingChars(password, policy.maxRepeatingChars)) {
    warnings.push(`Password has too many repeating characters (max ${policy.maxRepeatingChars})`);
    score -= 10;
  }

  // Keyboard patterns check
  if (hasKeyboardPatterns(password)) {
    warnings.push('Password contains keyboard patterns which are easier to guess');
    score -= 15;
  }

  // Entropy bonus
  const entropy = calculateEntropy(password);
  if (entropy > 60) {
    score += 15;
  } else if (entropy > 40) {
    score += 10;
  } else if (entropy < 30) {
    warnings.push('Password has low entropy and may be vulnerable to attacks');
  }

  // Generate suggestions
  if (!hasUpper && !errors.some(e => e.includes('uppercase'))) {
    suggestions.push('Add uppercase letters for better security');
  }
  if (!hasLower && !errors.some(e => e.includes('lowercase'))) {
    suggestions.push('Add lowercase letters for better security');
  }
  if (!hasNumbers && !errors.some(e => e.includes('number'))) {
    suggestions.push('Add numbers for better security');
  }
  if (!hasSpecial && !errors.some(e => e.includes('special'))) {
    suggestions.push('Add special characters (!@#$%^&*) for better security');
  }
  if (password.length < 16) {
    suggestions.push('Consider using a longer password (16+ characters) for maximum security');
  }

  // Ensure score is within bounds
  score = Math.max(0, Math.min(100, score));

  const isValid = errors.length === 0;

  // Log password validation attempts for security monitoring
  if (!isValid) {
    Logger.security('Password validation failed', {
      severity: 'low',
      event: 'password_validation_failed',
      errorCount: errors.length,
      warningCount: warnings.length,
      score,
      hasUserInfo: userInfo ? containsUserInfo(password, userInfo) : false
    });
  }

  return {
    isValid,
    score,
    errors,
    warnings,
    suggestions
  };
}

/**
 * Generate a secure password suggestion
 */
export function generateSecurePassword(length: number = 16): string {
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const numbers = '0123456789';
  const special = '!@#$%^&*()_+-=[]{}|;:,.<>?';
  
  const allChars = uppercase + lowercase + numbers + special;
  
  let password = '';
  
  // Ensure at least one character from each category
  password += uppercase[Math.floor(Math.random() * uppercase.length)];
  password += lowercase[Math.floor(Math.random() * lowercase.length)];
  password += numbers[Math.floor(Math.random() * numbers.length)];
  password += special[Math.floor(Math.random() * special.length)];
  
  // Fill the rest randomly
  for (let i = 4; i < length; i++) {
    password += allChars[Math.floor(Math.random() * allChars.length)];
  }
  
  // Shuffle the password to avoid predictable patterns
  return password.split('').sort(() => Math.random() - 0.5).join('');
}

/**
 * Check if password has been compromised (placeholder for future integration with HaveIBeenPwned API)
 */
export async function checkPasswordBreach(password: string): Promise<boolean> {
  // TODO: Integrate with HaveIBeenPwned API or similar service
  // For now, just check against our common passwords list
  return COMMON_PASSWORDS.has(password.toLowerCase());
}

/**
 * Password strength meter text
 */
export function getPasswordStrengthText(score: number): string {
  if (score >= 80) return 'Very Strong';
  if (score >= 60) return 'Strong';
  if (score >= 40) return 'Moderate';
  if (score >= 20) return 'Weak';
  return 'Very Weak';
}

/**
 * Get password strength color for UI
 */
export function getPasswordStrengthColor(score: number): string {
  if (score >= 80) return '#22c55e'; // green
  if (score >= 60) return '#84cc16'; // lime
  if (score >= 40) return '#eab308'; // yellow
  if (score >= 20) return '#f97316'; // orange
  return '#ef4444'; // red
}
