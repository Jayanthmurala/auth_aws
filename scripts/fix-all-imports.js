#!/usr/bin/env node

/**
 * Fix All ES Module Imports - Add .js extensions to ALL local imports
 * This script fixes ALL ERR_MODULE_NOT_FOUND errors by adding .js extensions
 * to all local imports in the src/ directory
 */

import { readdir, readFile, writeFile } from 'fs/promises';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const srcDir = join(__dirname, '..', 'src');

async function fixImportsInFile(filePath) {
  try {
    const content = await readFile(filePath, 'utf8');
    
    // Regex patterns for different import/export types
    const patterns = [
      // import ... from "../path" or "./path"
      /(import\s+.*?\s+from\s+['"`])(\.[^'"`]*?)(['"`])/g,
      // export ... from "../path" or "./path"  
      /(export\s+.*?\s+from\s+['"`])(\.[^'"`]*?)(['"`])/g,
      // import("../path") or import("./path")
      /(import\s*\(\s*['"`])(\.[^'"`]*?)(['"`]\s*\))/g,
    ];
    
    let modified = false;
    let newContent = content;
    
    patterns.forEach(pattern => {
      newContent = newContent.replace(pattern, (match, prefix, path, suffix) => {
        // Skip if already has .js extension or is a directory import
        if (path.endsWith('.js') || path.endsWith('.json') || path.includes('node_modules')) {
          return match;
        }
        
        // Add .js extension to local imports
        modified = true;
        return `${prefix}${path}.js${suffix}`;
      });
    });
    
    if (modified) {
      await writeFile(filePath, newContent, 'utf8');
      console.log(`✅ Fixed imports in: ${filePath.replace(srcDir, 'src')}`);
      return true;
    }
    
    return false;
  } catch (error) {
    console.error(`❌ Error processing ${filePath}:`, error.message);
    return false;
  }
}

async function processDirectory(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    let totalFixed = 0;
    
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      
      if (entry.isDirectory()) {
        // Skip node_modules, dist, tests directories
        if (!['node_modules', 'dist', '__tests__', 'tests'].includes(entry.name)) {
          totalFixed += await processDirectory(fullPath);
        }
      } else if (entry.isFile() && extname(entry.name) === '.ts') {
        const fixed = await fixImportsInFile(fullPath);
        if (fixed) totalFixed++;
      }
    }
    
    return totalFixed;
  } catch (error) {
    console.error(`❌ Error processing directory ${dir}:`, error.message);
    return 0;
  }
}

async function main() {
  console.log('🔧 Fixing ALL ES module imports in src/ directory...');
  console.log(`📁 Processing: ${srcDir}`);
  
  try {
    const fixedCount = await processDirectory(srcDir);
    console.log(`\n✅ Successfully fixed imports in ${fixedCount} files`);
    
    if (fixedCount === 0) {
      console.log('ℹ️  No files needed fixing - imports are already correct');
    } else {
      console.log('\n🚀 Next steps:');
      console.log('   1. Rebuild TypeScript: npm run build');
      console.log('   2. Rebuild Docker: docker build -f Dockerfile.production -t nexus-auth-service .');
      console.log('   3. Test container: docker run --env-file .env -p 4001:4001 nexus-auth-service');
    }
  } catch (error) {
    console.error('❌ Failed to fix imports:', error.message);
    process.exit(1);
  }
}

main();
