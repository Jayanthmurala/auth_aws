#!/usr/bin/env node

/**
 * Simple ES Module Import Fixer
 * Adds .js extensions to all relative imports in TypeScript files
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
    
    // Simple regex to match all relative imports without .js extension
    const importRegex = /(import\s+[^;]+from\s+['"`])(\.[^'"`]*?)(['"`])/g;
    const exportRegex = /(export\s+[^;]+from\s+['"`])(\.[^'"`]*?)(['"`])/g;
    
    let modified = false;
    let newContent = content;
    
    // Fix import statements
    newContent = newContent.replace(importRegex, (match, prefix, path, suffix) => {
      if (!path.endsWith('.js') && !path.endsWith('.json') && !path.includes('node_modules')) {
        modified = true;
        return `${prefix}${path}.js${suffix}`;
      }
      return match;
    });
    
    // Fix export statements
    newContent = newContent.replace(exportRegex, (match, prefix, path, suffix) => {
      if (!path.endsWith('.js') && !path.endsWith('.json') && !path.includes('node_modules')) {
        modified = true;
        return `${prefix}${path}.js${suffix}`;
      }
      return match;
    });
    
    if (modified) {
      await writeFile(filePath, newContent, 'utf8');
      console.log(`✅ Fixed: ${filePath.replace(srcDir, 'src')}`);
      return true;
    }
    
    return false;
  } catch (error) {
    console.error(`❌ Error: ${filePath}:`, error.message);
    return false;
  }
}

async function processDirectory(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    let totalFixed = 0;
    
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      
      if (entry.isDirectory() && !['node_modules', 'dist', '__tests__'].includes(entry.name)) {
        totalFixed += await processDirectory(fullPath);
      } else if (entry.isFile() && extname(entry.name) === '.ts') {
        const fixed = await fixImportsInFile(fullPath);
        if (fixed) totalFixed++;
      }
    }
    
    return totalFixed;
  } catch (error) {
    console.error(`❌ Directory error ${dir}:`, error.message);
    return 0;
  }
}

async function main() {
  console.log('🔧 Fixing ES module imports...');
  
  try {
    const fixedCount = await processDirectory(srcDir);
    console.log(`\n✅ Fixed ${fixedCount} files`);
    
    if (fixedCount > 0) {
      console.log('\n🚀 Next: npm run build && docker build -f Dockerfile.production -t nexus-auth-service .');
    } else {
      console.log('ℹ️  No files needed fixing');
    }
  } catch (error) {
    console.error('❌ Failed:', error.message);
    process.exit(1);
  }
}

main();
