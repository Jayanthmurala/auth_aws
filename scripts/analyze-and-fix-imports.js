#!/usr/bin/env node

/**
 * Comprehensive ES Module Import Analyzer and Fixer
 * Analyzes all TypeScript files and fixes import issues for ES modules
 */

import { readdir, readFile, writeFile, stat } from 'fs/promises';
import { join, dirname, extname, relative } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const srcDir = join(__dirname, '..', 'src');

// Track all issues found
const issues = {
  missingExtensions: [],
  missingFiles: [],
  invalidPaths: [],
  fixed: []
};

// Common patterns for imports/exports
const importPatterns = [
  // Standard imports: import ... from "path"
  /(import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+|\w+))*\s+)?from\s+['"`])([^'"`]+)(['"`])/g,
  // Export from: export ... from "path"
  /(export\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+|\w+))*\s+)?from\s+['"`])([^'"`]+)(['"`])/g,
  // Dynamic imports: import("path")
  /(import\s*\(\s*['"`])([^'"`]+)(['"`]\s*\))/g,
];

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findSourceFile(basePath, importPath) {
  const possibleExtensions = ['.ts', '.js', '.json'];
  const possiblePaths = [
    importPath,
    `${importPath}/index`,
  ];

  for (const path of possiblePaths) {
    for (const ext of possibleExtensions) {
      const fullPath = join(basePath, `${path}${ext}`);
      if (await fileExists(fullPath)) {
        return { exists: true, actualPath: path, extension: ext };
      }
    }
  }

  return { exists: false, actualPath: importPath, extension: null };
}

async function analyzeFile(filePath) {
  try {
    const content = await readFile(filePath, 'utf8');
    const relativePath = relative(srcDir, filePath);
    const fileDir = dirname(filePath);
    
    console.log(`🔍 Analyzing: ${relativePath}`);
    
    let hasChanges = false;
    let newContent = content;
    const fileIssues = [];

    for (const pattern of importPatterns) {
      newContent = newContent.replace(pattern, (match, prefix, importPath, suffix) => {
        // Skip external modules (no relative path)
        if (!importPath.startsWith('.')) {
          return match;
        }

        // Skip if already has proper extension
        if (importPath.endsWith('.js') || importPath.endsWith('.json')) {
          return match;
        }

        // Resolve the import path relative to current file
        const resolvedPath = join(fileDir, importPath);
        const relativeToSrc = relative(srcDir, resolvedPath);

        // Check if source file exists
        findSourceFile(fileDir, importPath).then(async (result) => {
          if (!result.exists) {
            fileIssues.push({
              type: 'missing',
              import: importPath,
              file: relativePath,
              line: content.split('\n').findIndex(line => line.includes(match)) + 1
            });
          }
        });

        // Add .js extension for ES modules
        const fixedImport = `${importPath}.js`;
        hasChanges = true;
        
        fileIssues.push({
          type: 'fixed',
          original: importPath,
          fixed: fixedImport,
          file: relativePath
        });

        return `${prefix}${fixedImport}${suffix}`;
      });
    }

    // Write changes if any
    if (hasChanges) {
      await writeFile(filePath, newContent, 'utf8');
      issues.fixed.push({
        file: relativePath,
        issues: fileIssues.filter(i => i.type === 'fixed')
      });
      console.log(`  ✅ Fixed ${fileIssues.filter(i => i.type === 'fixed').length} imports`);
    }

    // Track issues
    issues.missingFiles.push(...fileIssues.filter(i => i.type === 'missing'));

    return { hasChanges, issues: fileIssues };
  } catch (error) {
    console.error(`❌ Error analyzing ${filePath}:`, error.message);
    return { hasChanges: false, issues: [] };
  }
}

async function processDirectory(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    let totalFixed = 0;

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        // Skip certain directories
        if (['node_modules', 'dist', '__tests__', '.git'].includes(entry.name)) {
          continue;
        }
        totalFixed += await processDirectory(fullPath);
      } else if (entry.isFile() && extname(entry.name) === '.ts') {
        const result = await analyzeFile(fullPath);
        if (result.hasChanges) totalFixed++;
      }
    }

    return totalFixed;
  } catch (error) {
    console.error(`❌ Error processing directory ${dir}:`, error.message);
    return 0;
  }
}

async function validateDistDirectory() {
  const distDir = join(__dirname, '..', 'dist');
  console.log('\n🔍 Validating dist/ directory structure...');

  try {
    const entries = await readdir(distDir, { withFileTypes: true });
    const structure = {};

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subEntries = await readdir(join(distDir, entry.name));
        structure[entry.name] = subEntries.filter(f => f.endsWith('.js'));
      } else if (entry.name.endsWith('.js')) {
        structure[entry.name] = 'file';
      }
    }

    console.log('📁 Dist structure:');
    Object.entries(structure).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        console.log(`  📂 ${key}/`);
        value.forEach(file => console.log(`    📄 ${file}`));
      } else {
        console.log(`  📄 ${key}`);
      }
    });

    return structure;
  } catch (error) {
    console.log(`⚠️  Dist directory not found or empty: ${error.message}`);
    return {};
  }
}

async function generateReport() {
  console.log('\n📊 Import Analysis Report');
  console.log('========================');

  if (issues.fixed.length > 0) {
    console.log(`\n✅ Fixed Files (${issues.fixed.length}):`);
    issues.fixed.forEach(({ file, issues: fileIssues }) => {
      console.log(`  📄 ${file}`);
      fileIssues.forEach(issue => {
        console.log(`    • ${issue.original} → ${issue.fixed}`);
      });
    });
  }

  if (issues.missingFiles.length > 0) {
    console.log(`\n❌ Missing Files (${issues.missingFiles.length}):`);
    issues.missingFiles.forEach(issue => {
      console.log(`  📄 ${issue.file}:${issue.line} - Cannot find: ${issue.import}`);
    });
  }

  if (issues.fixed.length === 0 && issues.missingFiles.length === 0) {
    console.log('\n🎉 No issues found! All imports are correct.');
  }
}

async function testCompilation() {
  console.log('\n🧪 Testing TypeScript compilation...');
  
  try {
    const { spawn } = await import('child_process');
    
    return new Promise((resolve) => {
      const tsc = spawn('npx', ['tsc', '--noEmit'], {
        cwd: join(__dirname, '..'),
        stdio: 'pipe'
      });

      let output = '';
      let errors = '';

      tsc.stdout.on('data', (data) => {
        output += data.toString();
      });

      tsc.stderr.on('data', (data) => {
        errors += data.toString();
      });

      tsc.on('close', (code) => {
        if (code === 0) {
          console.log('✅ TypeScript compilation successful');
        } else {
          console.log('❌ TypeScript compilation failed:');
          console.log(errors || output);
        }
        resolve(code === 0);
      });
    });
  } catch (error) {
    console.log('⚠️  Could not test TypeScript compilation:', error.message);
    return false;
  }
}

async function main() {
  console.log('🚀 Comprehensive ES Module Import Analysis');
  console.log('==========================================');
  console.log(`📁 Source directory: ${srcDir}`);

  try {
    // Step 1: Analyze and fix all imports
    const fixedCount = await processDirectory(srcDir);
    
    // Step 2: Generate report
    await generateReport();
    
    // Step 3: Validate dist directory if it exists
    await validateDistDirectory();
    
    // Step 4: Test compilation
    await testCompilation();

    console.log('\n🎯 Summary:');
    console.log(`  • Files processed: ${issues.fixed.length + (issues.missingFiles.length > 0 ? 1 : 0)}`);
    console.log(`  • Imports fixed: ${issues.fixed.reduce((sum, f) => sum + f.issues.length, 0)}`);
    console.log(`  • Missing files: ${issues.missingFiles.length}`);

    if (fixedCount > 0) {
      console.log('\n🚀 Next steps:');
      console.log('  1. Review the changes above');
      console.log('  2. Run: npm run build');
      console.log('  3. Run: docker build -f Dockerfile.production -t nexus-auth-service .');
      console.log('  4. Test: docker run --env-file .env -p 4001:4001 nexus-auth-service');
    }

  } catch (error) {
    console.error('❌ Analysis failed:', error.message);
    process.exit(1);
  }
}

main();
