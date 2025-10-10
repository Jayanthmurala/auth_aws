-- Fix DEPT_ADMIN Department Assignment
-- This script assigns a department to DEPT_ADMIN users who don't have one

-- First, check which DEPT_ADMIN users don't have departments
SELECT 
    id, 
    email, 
    "displayName", 
    roles, 
    department,
    "collegeId"
FROM "User" 
WHERE 'DEPT_ADMIN' = ANY(roles) 
AND department IS NULL;

-- Update DEPT_ADMIN users to have a department
-- Replace 'Computer Science' with the actual department name
-- Replace 'your-college-id' with the actual college ID

UPDATE "User" 
SET department = 'Computer Science'
WHERE 'DEPT_ADMIN' = ANY(roles) 
AND department IS NULL
AND "collegeId" = 'your-college-id';

-- Verify the update
SELECT 
    id, 
    email, 
    "displayName", 
    roles, 
    department,
    "collegeId"
FROM "User" 
WHERE 'DEPT_ADMIN' = ANY(roles);

-- Alternative: If you need to find available departments from a college
SELECT departments FROM "College" WHERE id = 'your-college-id';
