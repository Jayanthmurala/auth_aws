import { z } from "zod";

export const rolesEnum = z.enum([
  "STUDENT",
  "FACULTY",
]);

// Enhanced password validation schema
const passwordSchema = z.string()
  .min(8, "Password must be at least 8 characters long")
  .max(128, "Password must be less than 128 characters")
  .regex(/^(?=.*[a-z])/, "Password must contain at least one lowercase letter")
  .regex(/^(?=.*[A-Z])/, "Password must contain at least one uppercase letter")
  .regex(/^(?=.*\d)/, "Password must contain at least one number")
  .regex(/^(?=.*[@$!%*?&])/, "Password must contain at least one special character (@$!%*?&)");

export const registerBodySchema = z.object({
  displayName: z.string().min(2, "Display name must be at least 2 characters long").max(100, "Display name must be less than 100 characters"),
  email: z.string().email("Please provide a valid email address").toLowerCase(),
  password: passwordSchema,
  role: rolesEnum.optional().default("STUDENT"),
  collegeId: z.string().min(1, "College selection is required"),
  department: z.string().min(1, "Department selection is required"),
  collegeMemberId: z.string().optional(),
  year: z.number().int().min(1, "Year must be between 1 and 6").max(6, "Year must be between 1 and 6").optional(),
});

export const loginBodySchema = z.object({
  email: z.string().email("Please provide a valid email address"),
  password: z.string().min(1, "Password is required"),
});

// For existing users who might have admin roles in database
const allRolesEnum = z.enum([
  "STUDENT",
  "FACULTY", 
  "DEPT_ADMIN",
  "PLACEMENTS_ADMIN",
  "HEAD_ADMIN",
  "SUPER_ADMIN"
]);

export const authUserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  displayName: z.string(),
  roles: z.array(allRolesEnum),
  avatarUrl: z.string().nullable().optional(),
  collegeId: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
  year: z.number().int().nullable().optional(),
  collegeMemberId: z.string().nullable().optional(),
});

export const authSuccessResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    accessToken: z.string(),
    user: authUserSchema,
  }),
});

// Generic error payload used by 4xx responses
export const errorResponseSchema = z.object({
  message: z.string(),
});

// Enhanced error payload with error codes for OAuth and auth failures
export const authErrorResponseSchema = z.object({
  message: z.string(),
  code: z.string().optional(),
});

// Generic message payload used by 2xx responses
export const messageResponseSchema = z.object({
  message: z.string(),
  debugUrl: z.string().url().optional(),
  debugPreviewUrl: z.string().url().optional(),
});

export type ErrorResponse = z.infer<typeof errorResponseSchema>;
export type AuthErrorResponse = z.infer<typeof authErrorResponseSchema>;

export type RegisterBody = z.infer<typeof registerBodySchema>;
export type LoginBody = z.infer<typeof loginBodySchema>;
export type AuthSuccessResponse = z.infer<typeof authSuccessResponseSchema>;

// OAuth exchange
export const oauthExchangeBodySchema = z.object({
  provider: z.enum(["google", "github"]),
  accessToken: z.string(),
  idToken: z.string().optional(),
});

// Forgot/Reset/Verify
export const forgotPasswordBodySchema = z.object({
  email: z.string().email(),
});

export const resetPasswordBodySchema = z.object({
  token: z.string().min(10, "Invalid reset token"),
  password: passwordSchema,
});

export const verifyEmailBodySchema = z.object({
  token: z.string().min(10),
});

export const resendVerificationBodySchema = z.object({
  email: z.string().email(),
});

// P1: Comprehensive user validation schemas
export const userUpdateBodySchema = z.object({
  displayName: z.string()
    .min(2, "Display name must be at least 2 characters")
    .max(100, "Display name must be less than 100 characters")
    .regex(/^[a-zA-Z0-9\s\-_.]+$/, "Display name contains invalid characters")
    .optional(),
  avatarUrl: z.string()
    .url("Invalid avatar URL")
    .max(500, "Avatar URL too long")
    .optional(),
  collegeId: z.string()
    .cuid("Invalid college ID format")
    .optional(),
  department: z.string()
    .min(1, "Department cannot be empty")
    .max(100, "Department name too long")
    .regex(/^[a-zA-Z0-9\s\-_&]+$/, "Department contains invalid characters")
    .optional(),
  year: z.number()
    .int("Year must be an integer")
    .min(1, "Year must be between 1 and 6")
    .max(6, "Year must be between 1 and 6")
    .optional()
});

export const userSearchQuerySchema = z.object({
  q: z.string()
    .max(100, "Search query too long")
    .regex(/^[a-zA-Z0-9\s\-_.@]*$/, "Search query contains invalid characters")
    .optional(),
  role: z.enum(["STUDENT", "FACULTY"], {
    errorMap: () => ({ message: "Role must be either STUDENT or FACULTY" })
  }).optional(),
  collegeId: z.string()
    .cuid("Invalid college ID format")
    .optional(),
  department: z.string()
    .max(100, "Department name too long")
    .regex(/^[a-zA-Z0-9\s\-_&]*$/, "Department contains invalid characters")
    .optional(),
  limit: z.string()
    .regex(/^\d+$/, "Limit must be a number")
    .transform(val => Math.min(parseInt(val), 50))
    .optional(),
  offset: z.string()
    .regex(/^\d+$/, "Offset must be a number")
    .transform(val => Math.max(parseInt(val), 0))
    .optional()
});

export const userBatchBodySchema = z.object({
  userIds: z.array(z.string().cuid("Invalid user ID format"))
    .min(1, "At least one user ID required")
    .max(100, "Too many user IDs (max 100)")
});

export const userDiscoveryQuerySchema = z.object({
  scope: z.enum(['college', 'global', 'mixed'], {
    errorMap: () => ({ message: "Scope must be college, global, or mixed" })
  }).optional(),
  limit: z.string()
    .regex(/^\d+$/, "Limit must be a number")
    .transform(val => Math.min(parseInt(val), 50))
    .optional(),
  seed: z.string()
    .max(50, "Seed too long")
    .optional()
});

// Export types
export type UserUpdateBody = z.infer<typeof userUpdateBodySchema>;
export type UserSearchQuery = z.infer<typeof userSearchQuerySchema>;
export type UserBatchBody = z.infer<typeof userBatchBodySchema>;
export type UserDiscoveryQuery = z.infer<typeof userDiscoveryQuerySchema>;

