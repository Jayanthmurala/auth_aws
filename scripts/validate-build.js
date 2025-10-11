#!/usr/bin/env node

/**
 * Build Validation Script
 * Validates that all required files exist in dist/ and imports are correct
 */

import { readdir, readFile, stat } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const distDir = join(__dirname, '..', 'dist');

async function checkFileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function validateDistStructure() {
  console.log('🔍 Validating dist/ directory structure...');
  
  const requiredFiles = [
    'index.js',
    'db.js',
    'config/env.js',
    'routes/auth.routes.js',
    'routes/users.routes.js',
    'routes/college.routes.js',
    'routes/security.routes.js',
    'middleware/authMiddleware.js',
    'middleware/advancedSecurity.js',
    'schemas/auth.schemas.js',
    'utils/jwt.js',
    'utils/crypto.js',
    'services/token.service.js',
    'services/user.service.js'
  ];

  const missing = [];
  const existing = [];

  for (const file of requiredFiles) {
    const fullPath = join(distDir, file);
    if (await checkFileExists(fullPath)) {
      existing.push(file);
      console.log(`✅ ${file}`);
    } else {
      missing.push(file);
      console.log(`❌ ${file} - MISSING`);
    }
  }

  return { existing, missing };
}

async function validateImports() {
  console.log('\n🔍 Validating imports in compiled files...');
  
  const indexPath = join(distDir, 'index.js');
  
  if (!(await checkFileExists(indexPath))) {
    console.log('❌ index.js not found in dist/');
    return false;
  }

  try {
    const content = await readFile(indexPath, 'utf8');
    const importLines = content.split('\n').filter(line => 
      line.trim().startsWith('import ') && line.includes('from ')
    );

    console.log(`📄 Found ${importLines.length} imports in index.js:`);
    
    let allValid = true;
    for (const line of importLines) {
      const match = line.match(/from\s+['"`]([^'"`]+)['"`]/);
      if (match) {
        const importPath = match[1];
        if (importPath.startsWith('.')) {
          // Check if relative import has .js extension
          if (!importPath.endsWith('.js') && !importPath.endsWith('.json')) {
            console.log(`⚠️  Missing .js extension: ${importPath}`);
            allValid = false;
          } else {
            console.log(`✅ ${importPath}`);
          }
        }
      }
    }

    return allValid;
  } catch (error) {
    console.log(`❌ Error reading index.js: ${error.message}`);
    return false;
  }
}

async function testNodeExecution() {
  console.log('\n🧪 Testing Node.js execution...');
  
  try {
    const { spawn } = await import('child_process');
    
    return new Promise((resolve) => {
      const node = spawn('node', ['--check', 'dist/index.js'], {
        cwd: join(__dirname, '..'),
        stdio: 'pipe'
      });

      let output = '';
      let errors = '';

      node.stdout.on('data', (data) => {
        output += data.toString();
      });

      node.stderr.on('data', (data) => {
        errors += data.toString();
      });

      node.on('close', (code) => {
        if (code === 0) {
          console.log('✅ Node.js syntax check passed');
          resolve(true);
        } else {
          console.log('❌ Node.js syntax check failed:');
          console.log(errors || output);
          resolve(false);
        }
      });
    });
  } catch (error) {
    console.log('⚠️  Could not test Node.js execution:', error.message);
    return false;
  }
}

async function main() {
  console.log('🚀 Build Validation Report');
  console.log('==========================');

  try {
    // Step 1: Check dist structure
    const { existing, missing } = await validateDistStructure();
    
    // Step 2: Validate imports
    const importsValid = await validateImports();
    
    // Step 3: Test Node execution
    const nodeValid = await testNodeExecution();

    // Summary
    console.log('\n📊 Validation Summary:');
    console.log(`  • Required files: ${existing.length}/${existing.length + missing.length}`);
    console.log(`  • Import syntax: ${importsValid ? 'Valid' : 'Invalid'}`);
    console.log(`  • Node.js check: ${nodeValid ? 'Passed' : 'Failed'}`);

    if (missing.length > 0) {
      console.log('\n❌ Missing files:');
      missing.forEach(file => console.log(`  • ${file}`));
    }

    const allValid = missing.length === 0 && importsValid && nodeValid;
    
    if (allValid) {
      console.log('\n🎉 Build validation successful! Ready for Docker.');
    } else {
      console.log('\n⚠️  Build validation failed. Fix issues before Docker build.');
    }

    process.exit(allValid ? 0 : 1);

  } catch (error) {
    console.error('❌ Validation failed:', error.message);
    process.exit(1);
  }
}

main();
