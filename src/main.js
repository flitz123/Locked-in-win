const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;

// Import the FocusManager
const FocusManager = require('./focusManager');

// Initialize app
let mainWindow;
const focusManager = new FocusManager();

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
    title: 'Locked In - Focus App'
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
        </body>
      </html>
    `);
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Open dev tools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
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
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Communications
ipcMain.handle('get-focus-sessions', () => {
  return focusManager.getSessions();
});

ipcMain.handle('start-focus-session', async (event, settings) => {
  return await focusManager.startSession(settings);
});

ipcMain.handle('stop-focus-session', async () => {
  return await focusManager.stopSession();
});

ipcMain.handle('show-app-picker', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'Applications', extensions: ['exe'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    
    if (!result.canceled && result.filePaths.length > 0) {
      return { app: path.basename(result.filePaths[0], '.exe') };
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

// Detect installed apps function
async function detectInstalledApps() {
  const apps = [];
  const platform = process.platform;

  if (platform === 'win32') {
    const programPaths = [
      process.env.ProgramFiles,
      process.env['ProgramFiles(x86)'],
      process.env.LOCALAPPDATA,
      process.env.APPDATA
    ].filter(Boolean);

    for (const programPath of programPaths) {
      try {
        const items = await fs.readdir(programPath, { withFileTypes: true });
        for (const item of items) {
          if (item.name.endsWith('.exe')) {
            const appName = item.name.replace('.exe', '');
            apps.push({
              name: appName,
              displayName: appName,
              path: path.join(programPath, item.name),
              type: 'executable'
            });
          }
        }
      } catch (err) {
        console.log('Could not read directory:', programPath, err.message);
      }
    }
  }

  // Remove duplicates and sort alphabetically
  const uniqueApps = apps.filter((app, index, self) =>
    index === self.findIndex(a => a.name === app.name)
  ).sort((a, b) => a.name.localeCompare(b.name));

  return uniqueApps.slice(0, 50);
}