#!/usr/bin/env node

/**
 * Fix ES Module Imports - Add .js extensions to compiled JavaScript files
 * This script fixes the ERR_MODULE_NOT_FOUND errors by adding .js extensions
 * to all local imports in the compiled dist/ directory
 */

import { readdir, readFile, writeFile } from 'fs/promises';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const distDir = join(__dirname, '..', 'dist');

async function fixImportsInFile(filePath) {
  try {
    const content = await readFile(filePath, 'utf8');
    
    // Regex to match import/export statements with relative paths
    const importRegex = /(import\s+.*?\s+from\s+['"`])(\.\/.*?)(['"`])/g;
    const exportRegex = /(export\s+.*?\s+from\s+['"`])(\.\/.*?)(['"`])/g;
    
    let modified = false;
    let newContent = content;
    
    // Fix import statements
    newContent = newContent.replace(importRegex, (match, prefix, path, suffix) => {
      if (!path.endsWith('.js') && !path.includes('node_modules')) {
        modified = true;
        return `${prefix}${path}.js${suffix}`;
      }
      return match;
    });
    
    // Fix export statements
    newContent = newContent.replace(exportRegex, (match, prefix, path, suffix) => {
      if (!path.endsWith('.js') && !path.includes('node_modules')) {
        modified = true;
        return `${prefix}${path}.js${suffix}`;
      }
      return match;
    });
    
    if (modified) {
      await writeFile(filePath, newContent, 'utf8');
      console.log(`✅ Fixed imports in: ${filePath}`);
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
        totalFixed += await processDirectory(fullPath);
      } else if (entry.isFile() && extname(entry.name) === '.js') {
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
  console.log('🔧 Fixing ES module imports in dist/ directory...');
  console.log(`📁 Processing: ${distDir}`);
  
  try {
    const fixedCount = await processDirectory(distDir);
    console.log(`\n✅ Successfully fixed imports in ${fixedCount} files`);
    
    if (fixedCount === 0) {
      console.log('ℹ️  No files needed fixing - imports are already correct');
    }
  } catch (error) {
    console.error('❌ Failed to fix imports:', error.message);
    process.exit(1);
  }
}

main();
