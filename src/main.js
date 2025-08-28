const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const { exec } = require('child_process');

// Import the FocusManager
const FocusManager = require('./focusManager');

// Initialize app
let mainWindow;
const focusManager = new FocusManager();

// Request elevated permissions on Windows
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('--high-dpi-support');
  app.commandLine.appendSwitch('--force-device-scale-factor', '1');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    backgroundColor: '#2f3241',
    show: false,
    title: 'Locked In - Focus App',
    center: true,
    resizable: true,
    minimizable: true,
    maximizable: true
  });

  // Load the HTML file with error handling
  const indexPath = path.join(__dirname, 'index.html');
  console.log('Loading index.html from:', indexPath);
  
  mainWindow.loadFile(indexPath).catch(err => {
    console.error('Failed to load index.html:', err);
    // Show error message in the window
    mainWindow.loadURL(`data:text/html;charset=utf-8,
      <html>
        <body style="background: #2f3241; color: white; font-family: Arial; padding: 20px;">
          <h1>Error Loading Application</h1>
          <p>Failed to load the application interface. Please check the console for details.</p>
          <p>Error: ${err.message}</p>
          <button onclick="location.reload()">Retry</button>
        </body>
      </html>
    `);
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    
    // Show admin rights warning on Windows (only once)
    const hasShownWarning = global.hasShownAdminWarning;
    if (process.platform === 'win32' && !hasShownWarning) {
      global.hasShownAdminWarning = true;
      setTimeout(() => {
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'Administrator Rights Recommended',
          message: 'For optimal app blocking performance',
          detail: 'Running as Administrator allows better process control during focus sessions. You can continue without it, but some apps might be harder to block.',
          buttons: ['OK', 'Don\'t show again'],
          defaultId: 0
        }).then(result => {
          if (result.response === 1) {
            // User chose "Don't show again"
            global.hasShownAdminWarning = true;
          }
        });
      }, 2000);
    }
  });

  // Open dev tools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    // Ensure focus session is stopped when main window closes
    if (focusManager.currentSession) {
      focusManager.stopSession();
    }
  });
}

// App lifecycle
app.whenReady().then(async () => {
  console.log('App is ready');
  
  try {
    await focusManager.init();
    console.log('FocusManager initialized successfully');
  } catch (err) {
    console.error('Failed to initialize focus manager:', err);
  }
  
  createWindow();
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Ensure session is stopped before quitting
  if (focusManager.currentSession) {
    focusManager.stopSession();
  }
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Communications
ipcMain.handle('get-focus-sessions', () => {
  return focusManager.getSessions();
});

ipcMain.handle('start-focus-session', async (event, settings) => {
  try {
    // Don't hide main window - keep desktop access
    const session = await focusManager.startSession(settings);
    return session;
  } catch (err) {
    console.error('Failed to start session:', err);
    throw err;
  }
});

ipcMain.handle('stop-focus-session', async () => {
  try {
    const result = await focusManager.stopSession();
    return result;
  } catch (err) {
    console.error('Failed to stop session:', err);
    throw err;
  }
});

ipcMain.handle('launch-app', async (event, appName) => {
  try {
    return await focusManager.launchApp(appName);
  } catch (err) {
    console.error('Failed to launch app:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('show-app-picker', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'Applications', extensions: ['exe', 'app', 'msi'] },
        { name: 'Executable Files', extensions: ['exe'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      title: 'Select Application to Add'
    });
    
    if (!result.canceled && result.filePaths.length > 0) {
      const filePath = result.filePaths[0];
      const fileName = path.basename(filePath);
      const appName = fileName.replace(/\.(exe|app|msi)$/i, '');
      return { app: appName, path: filePath, fileName };
    }
    return { app: null };
  } catch (err) {
    console.error('Error in show-app-picker:', err);
    return { app: null };
  }
});

ipcMain.handle('get-installed-apps', async () => {
  try {
    const apps = await detectInstalledApps();
    return apps;
  } catch (err) {
    console.error('Error detecting installed apps:', err);
    return [];
  }
});

ipcMain.handle('get-block-list', () => {
  return focusManager.getBlockList();
});

ipcMain.handle('add-to-block-list', (event, appName) => {
  return focusManager.addToBlockList(appName);
});

ipcMain.handle('remove-from-block-list', (event, appName) => {
  return focusManager.removeFromBlockList(appName);
});

// Enhanced app detection function
async function detectInstalledApps() {
  const apps = [];
  const platform = process.platform;

  if (platform === 'win32') {
    // Method 1: Check common program directories
    const programPaths = [
      process.env.ProgramFiles,
      process.env['ProgramFiles(x86)'],
      path.join(process.env.LOCALAPPDATA, 'Programs')
    ].filter(Boolean);

    for (const programPath of programPaths) {
      try {
        await scanDirectoryForApps(programPath, apps, 0, 2); // Max depth 2
      } catch (err) {
        console.log('Could not scan directory:', programPath);
      }
    }

    // Method 2: Check Start Menu shortcuts
    const startMenuPaths = [
      path.join(process.env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
      path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
    ];

    for (const startPath of startMenuPaths) {
      try {
        await scanStartMenuShortcuts(startPath, apps);
      } catch (err) {
        console.log('Could not scan start menu:', startPath);
      }
    }

    // Method 3: Registry-based detection (Windows specific)
    try {
      await getInstalledAppsFromRegistry(apps);
    } catch (err) {
      console.log('Could not scan registry:', err.message);
    }

    // Method 4: Common application paths
    const commonAppPaths = [
      { name: 'Chrome', paths: ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'] },
      { name: 'Firefox', paths: ['C:\\Program Files\\Mozilla Firefox\\firefox.exe', 'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe'] },
      { name: 'Edge', paths: ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'] },
      { name: 'Notepad++', paths: ['C:\\Program Files\\Notepad++\\notepad++.exe', 'C:\\Program Files (x86)\\Notepad++\\notepad++.exe'] },
      { name: 'VSCode', paths: [path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe')] },
      { name: 'Spotify', paths: [path.join(process.env.APPDATA, 'Spotify', 'Spotify.exe')] },
      { name: 'Discord', paths: [path.join(process.env.LOCALAPPDATA, 'Discord', 'app-*', 'Discord.exe')] }
    ];

    for (const app of commonAppPaths) {
      for (const appPath of app.paths) {
        try {
          // Handle wildcard paths
          if (appPath.includes('*')) {
            const baseDir = path.dirname(appPath);
            const fileName = path.basename(appPath);
            const items = await fs.readdir(baseDir);
            for (const item of items) {
              const fullPath = path.join(baseDir, item, fileName.replace('*', ''));
              try {
                await fs.access(fullPath);
                apps.push({
                  name: app.name.toLowerCase(),
                  displayName: app.name,
                  path: fullPath,
                  type: 'executable'
                });
                break;
              } catch (e) { }
            }
          } else {
            await fs.access(appPath);
            apps.push({
              name: app.name.toLowerCase(),
              displayName: app.name,
              path: appPath,
              type: 'executable'
            });
          }
        } catch (e) {
          // App not found at this path
        }
      }
    }

  } else if (platform === 'darwin') {
    // macOS applications
    const appDirs = ['/Applications', '/System/Applications', path.join(process.env.HOME, 'Applications')];
    for (const appDir of appDirs) {
      try {
        const items = await fs.readdir(appDir, { withFileTypes: true });
        for (const item of items) {
          if (item.isDirectory() && item.name.endsWith('.app')) {
            const appName = item.name.replace('.app', '');
            apps.push({
              name: appName.toLowerCase(),
              displayName: appName,
              path: path.join(appDir, item.name),
              type: 'application'
            });
          }
        }
      } catch (err) {
        console.log('Could not read directory:', appDir);
      }
    }
  }

  // Remove duplicates and sort
  const uniqueApps = apps.filter((app, index, self) =>
    index === self.findIndex(a => a.name === app.name)
  ).sort((a, b) => a.displayName.localeCompare(b.displayName));

  console.log(`Found ${uniqueApps.length} applications`);
  return uniqueApps.slice(0, 200); // Limit to 200 apps for performance
}

async function scanDirectoryForApps(dirPath, apps, currentDepth = 0, maxDepth = 2) {
  if (currentDepth > maxDepth) return;

  try {
    const items = await fs.readdir(dirPath, { withFileTypes: true });
    
    for (const item of items) {
      const fullPath = path.join(dirPath, item.name);
      
      if (item.isFile() && item.name.toLowerCase().endsWith('.exe')) {
        const appName = item.name.replace(/\.exe$/i, '');
        
        // Skip system files and common non-application executables
        if (!isSystemOrUtilityFile(appName.toLowerCase())) {
          apps.push({
            name: appName.toLowerCase(),
            displayName: appName,
            path: fullPath,
            type: 'executable'
          });
        }
      } else if (item.isDirectory() && currentDepth < maxDepth) {
        // Skip common system directories
        const skipDirs = ['system32', 'syswow64', 'windows', '$recycle.bin', 'temp'];
        if (!skipDirs.some(skip => item.name.toLowerCase().includes(skip))) {
          await scanDirectoryForApps(fullPath, apps, currentDepth + 1, maxDepth);
        }
      }
    }
  } catch (err) {
    // Ignore permission errors and continue
  }
}

async function scanStartMenuShortcuts(startMenuPath, apps) {
  try {
    const items = await fs.readdir(startMenuPath, { withFileTypes: true });
    
    for (const item of items) {
      const fullPath = path.join(startMenuPath, item.name);
      
      if (item.isFile() && item.name.toLowerCase().endsWith('.lnk')) {
        const appName = item.name.replace(/\.lnk$/i, '');
        
        // Skip system shortcuts
        if (!isSystemOrUtilityFile(appName.toLowerCase())) {
          apps.push({
            name: appName.toLowerCase(),
            displayName: appName,
            path: fullPath,
            type: 'shortcut'
          });
        }
      } else if (item.isDirectory()) {
        // Recursively scan subdirectories
        await scanStartMenuShortcuts(fullPath, apps);
      }
    }
  } catch (err) {
    // Ignore errors
  }
}

async function getInstalledAppsFromRegistry(apps) {
  return new Promise((resolve) => {
    // Query Windows Registry for installed programs
    const registryPaths = [
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
      'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
      'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
    ];

    let completed = 0;
    const totalPaths = registryPaths.length;

    registryPaths.forEach(regPath => {
      exec(`reg query "${regPath}" /s /v DisplayName`, (error, stdout, stderr) => {
        if (!error && stdout) {
          const lines = stdout.split('\n');
          for (const line of lines) {
            const match = line.match(/DisplayName\s+REG_SZ\s+(.+)/);
            if (match && match[1]) {
              const displayName = match[1].trim();
              const name = displayName.toLowerCase();
              
              // Skip system components and updates
              if (!isSystemOrUtilityFile(name) && 
                  !name.includes('update') && 
                  !name.includes('redistributable') &&
                  !name.includes('runtime') &&
                  displayName.length > 2) {
                
                apps.push({
                  name: name,
                  displayName: displayName,
                  path: '',
                  type: 'registered'
                });
              }
            }
          }
        }
        
        completed++;
        if (completed === totalPaths) {
          resolve();
        }
      });
    });

    // Timeout after 5 seconds
    setTimeout(() => {
      resolve();
    }, 5000);
  });
}

function isSystemOrUtilityFile(filename) {
  const systemFiles = [
    'uninstall', 'setup', 'install', 'update', 'helper', 'service',
    'rundll32', 'cmd', 'powershell', 'conhost', 'dwm', 'explorer',
    'taskmgr', 'winlogon', 'csrss', 'smss', 'lsass', 'svchost',
    'spoolsv', 'winmgmt', 'dllhost', 'msiexec', 'regsvr32', 'regdit',
    'msconfig', 'cleanmgr', 'defrag', 'chkdsk', 'sfc', 'dism',
    'microsoft', 'windows', 'system', 'driver', 'codec', 'framework',
    'redistributable', 'runtime', 'library', 'component'
  ];
  
  return systemFiles.some(sysFile => 
    filename.includes(sysFile) || 
    filename.startsWith('ms') || 
    filename.startsWith('win') ||
    filename.length < 3
  );
}
