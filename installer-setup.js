const { createWindowsInstaller } = require('electron-winstaller');
const path = require('path');

async function createInstaller() {
  try {
    console.log('Creating installer...');
    await createWindowsInstaller({
      appDirectory: path.join(__dirname, 'dist', 'Locked In-win32-x64'),
      outputDirectory: path.join(__dirname, 'dist', 'installer'),
      authors: 'Locked In Team',
      exe: 'Locked In.exe',
      setupExe: 'LockedInSetup.exe',
      setupIcon: path.join(__dirname, 'build', 'icon.ico'),
      noMsi: true
    });
    console.log('Installer created successfully!');
  } catch (e) {
    console.error(`Error creating installer: ${e.message}`);
  }
}

createInstaller();