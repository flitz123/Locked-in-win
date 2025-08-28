const path = require('path');
const fs = require('fs');

async function createInstaller() {
  try {
    console.log('🚀 Starting installer creation process...');
    
    // Check if electron-builder is available first
    try {
      require('electron-builder');
      console.log('✅ electron-builder found');
    } catch (err) {
      console.error('❌ electron-builder not found. Installing...');
      console.log('Please run: npm install electron-builder --save-dev');
      return;
    }

    // Import electron-builder
    const { build } = require('electron-builder');

    console.log('📦 Building application with electron-builder...');
    
    // Build the application first
    const buildResult = await build({
      targets: require('electron-builder').Platform.WINDOWS.createTarget(),
      config: {
        appId: 'com.lockedin.focusapp',
        productName: 'Locked In',
        directories: {
          output: 'dist'
        },
        files: [
          'src/**/*',
          'assets/**/*', 
          'build/**/*',
          '!node_modules/**/*',
          'node_modules/**/*'
        ],
        win: {
          target: [
            {
              target: 'nsis',
              arch: ['x64']
            }
          ],
          icon: 'build/icon.ico',
          requestedExecutionLevel: 'highestAvailable'
        },
        nsis: {
          oneClick: false,
          allowToChangeInstallationDirectory: true,
          createDesktopShortcut: true,
          createStartMenuShortcut: true,
          shortcutName: 'Locked In',
          runAfterFinish: true,
          installerIcon: 'build/icon.ico',
          uninstallerIcon: 'build/icon.ico',
          installerHeaderIcon: 'build/icon.ico',
          displayLanguageSelector: false,
          installerLanguages: ['en_US'],
          language: '1033'
        }
      }
    });

    console.log('✅ Installer created successfully!');
    
    // List created files in dist folder
    try {
      const distDir = path.join(__dirname, 'dist');
      const files = fs.readdirSync(distDir);
      
      console.log('\n📁 Created files in dist folder:');
      files.forEach(file => {
        const filePath = path.join(distDir, file);
        try {
          const stats = fs.statSync(filePath);
          if (stats.isFile()) {
            const sizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
            console.log(`  📄 ${file} (${sizeInMB} MB)`);
            
            if (file.includes('Setup') || file.includes('.exe')) {
              console.log(`  🎯 Main installer: ${file}`);
            }
          } else if (stats.isDirectory()) {
            console.log(`  📁 ${file}/`);
          }
        } catch (e) {
          console.log(`  ❓ ${file}`);
        }
      });
      
      // Find the main installer file
      const installerFile = files.find(file => 
        file.toLowerCase().includes('setup') && file.endsWith('.exe')
      );
      
      if (installerFile) {
        console.log(`\n🎉 SUCCESS! Your installer is ready:`);
        console.log(`📦 File: ${installerFile}`);
        console.log(`📍 Location: ${path.join(distDir, installerFile)}`);
        console.log(`\n💡 You can now distribute this installer to users!`);
      }
      
    } catch (err) {
      console.log('Could not list created files:', err.message);
    }
    
  } catch (error) {
    console.error(`❌ Error creating installer:`);
    console.error(`   ${error.message}`);
    
    if (error.stack) {
      console.log('\n🔧 Detailed error:');
      console.log(error.stack);
    }
    
    // Provide troubleshooting information
    console.log('\n🛠️  Troubleshooting steps:');
    console.log('1. Make sure all dependencies are installed:');
    console.log('   npm install electron-builder --save-dev');
    console.log('2. Verify your package.json has the correct build configuration');
    console.log('3. Check that build/icon.ico exists');
    console.log('4. Try running: npm run build-win');
    console.log('5. Make sure you have the latest Node.js and npm versions');
    
    // Check common issues
    checkCommonIssues();
  }
}

function checkCommonIssues() {
  console.log('\n🔍 Checking for common issues:');
  
  // Check Node.js version
  console.log(`Node.js version: ${process.version}`);
  
  // Check if icon exists
  const iconPath = path.join(__dirname, 'build', 'icon.ico');
  if (fs.existsSync(iconPath)) {
    console.log('✅ Icon file found at build/icon.ico');
  } else {
    console.log('❌ Icon file missing at build/icon.ico');
    console.log('   Create an icon file or remove icon references from package.json');
  }
  
  // Check package.json
  const packagePath = path.join(__dirname, 'package.json');
  if (fs.existsSync(packagePath)) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
      console.log('✅ package.json found');
      
      if (packageJson.build) {
        console.log('✅ Build configuration found in package.json');
      } else {
        console.log('⚠️  No build configuration in package.json');
      }
      
      if (packageJson.main) {
        const mainFile = path.join(__dirname, packageJson.main);
        if (fs.existsSync(mainFile)) {
          console.log('✅ Main file exists:', packageJson.main);
        } else {
          console.log('❌ Main file missing:', packageJson.main);
        }
      }
    } catch (e) {
      console.log('❌ Error reading package.json:', e.message);
    }
  } else {
    console.log('❌ package.json not found');
  }
  
  // Check src directory
  const srcDir = path.join(__dirname, 'src');
  if (fs.existsSync(srcDir)) {
    console.log('✅ src directory found');
  } else {
    console.log('❌ src directory missing');
  }
}

// Add timeout to prevent hanging
const timeout = setTimeout(() => {
  console.log('⏰ Process timed out after 5 minutes');
  process.exit(1);
}, 5 * 60 * 1000); // 5 minutes

// Run the installer creation
createInstaller().then(() => {
  clearTimeout(timeout);
  console.log('\n🏁 Installer creation process completed!');
}).catch((err) => {
  clearTimeout(timeout);
  console.error('\n💥 Installer creation failed:', err.message);
  process.exit(1);
});
