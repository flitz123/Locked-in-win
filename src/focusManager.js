const { app, Notification, shell } = require('electron');
const fs = require('fs').promises;
const path = require('path');
const { exec, spawn } = require('child_process');

class FocusManager {
  constructor() {
    this.sessions = [];
    this.currentSession = null;
    this.monitorInterval = null;
    this.blockedProcesses = new Set();
    this.allowedProcesses = new Set();
    this.isSessionActive = false;
    this.processCheckInterval = 3000; // Check every 3 seconds
    this.blockedAttempts = 0;
    this.launchedApps = new Set();
    
    // Ensure we have a valid app path
    let dataPath;
    try {
      dataPath = app.getPath('userData');
    } catch (err) {
      // Fallback for development
      dataPath = path.join(__dirname, 'data');
    }
    
    this.dataPath = path.join(dataPath, 'sessions.json');
    this.blockListPath = path.join(dataPath, 'blocklist.json');
  }

  async init() {
    try {
      // Ensure data directory exists
      const dataDir = path.dirname(this.dataPath);
      await fs.mkdir(dataDir, { recursive: true });
      
      // Try to load existing sessions
      try {
        const data = await fs.readFile(this.dataPath, 'utf8');
        this.sessions = JSON.parse(data);
        console.log('Loaded', this.sessions.length, 'existing sessions');
      } catch (err) {
        console.log('No existing sessions found, starting fresh');
        this.sessions = [];
      }
      
      // Try to load block list
      try {
        const blockData = await fs.readFile(this.blockListPath, 'utf8');
        const blockList = JSON.parse(blockData);
        blockList.forEach(app => this.blockedProcesses.add(app.toLowerCase()));
        console.log('Loaded', this.blockedProcesses.size, 'blocked applications');
      } catch (err) {
        console.log('No block list found, starting fresh');
        this.blockedProcesses = new Set();
      }
      
      return true;
    } catch (err) {
      console.error('Initialization error:', err);
      return false;
    }
  }

  async saveSessions() {
    try {
      await fs.writeFile(this.dataPath, JSON.stringify(this.sessions, null, 2));
      console.log('Sessions saved successfully');
    } catch (err) {
      console.error('Failed to save sessions:', err);
    }
  }

  async saveBlockList() {
    try {
      await fs.writeFile(this.blockListPath, JSON.stringify([...this.blockedProcesses], null, 2));
      console.log('Block list saved successfully');
    } catch (err) {
      console.error('Failed to save block list:', err);
    }
  }

  async startSession(settings) {
    if (this.currentSession) {
      await this.stopSession();
    }

    this.currentSession = {
      ...settings,
      startTime: Date.now(),
      activeTime: 0,
      distractions: 0,
      blockedAttempts: 0,
      id: Date.now().toString()
    };
    
    // Set allowed processes
    this.allowedProcesses.clear();
    settings.allowedApps.forEach(app => {
      this.allowedProcesses.add(app.toLowerCase());
    });
    
    // Add essential system processes that should always be allowed
    const systemProcesses = [
      'explorer', 'dwm', 'winlogon', 'csrss', 'smss', 'services', 
      'lsass', 'svchost', 'taskmgr', 'locked in', 'electron', 'cmd',
      'powershell', 'conhost', 'audiodg', 'spoolsv', 'dllhost',
      'registry', 'system', 'wininit', 'taskhost', 'wmiprvse'
    ];
    systemProcesses.forEach(proc => {
      this.allowedProcesses.add(proc.toLowerCase());
    });
    
    this.isSessionActive = true;
    this.blockedAttempts = 0;
    this.launchedApps.clear();
    
    console.log('Starting focus session:', this.currentSession);
    console.log('Allowed apps:', [...this.allowedProcesses]);
    console.log('Blocked apps:', [...this.blockedProcesses]);
    
    // Launch allowed applications if they're not running
    await this.launchAllowedApps(settings.allowedApps);
    
    // Start monitoring processes
    this.monitorInterval = setInterval(() => {
      this.monitorAndControlProcesses().catch(err => {
        console.error('Monitor process error:', err);
      });
    }, this.processCheckInterval);

    // Auto-stop after duration
    this.sessionTimeout = setTimeout(() => {
      if (this.currentSession && this.isSessionActive) {
        this.stopSession().catch(err => {
          console.error('Auto-stop error:', err);
        });
      }
    }, settings.duration * 60 * 1000);
    
    this.showNotification('Focus Session Started', 
      `Desktop locked to ${settings.allowedApps.length} apps for ${settings.duration} minutes. ${this.blockedProcesses.size} apps will be blocked.`);
    
    return this.currentSession;
  }

  async launchAllowedApps(allowedApps) {
    console.log('Launching allowed applications...');
    
    for (const appName of allowedApps) {
      try {
        const isRunning = await this.isAppRunning(appName);
        if (!isRunning) {
          console.log(`Launching ${appName}...`);
          await this.launchApp(appName);
          this.launchedApps.add(appName.toLowerCase());
          // Small delay between launches
          await new Promise(resolve => setTimeout(resolve, 1000));
        } else {
          console.log(`${appName} is already running`);
        }
      } catch (err) {
        console.log(`Could not launch ${appName}:`, err.message);
      }
    }
  }

  async isAppRunning(appName) {
    try {
      const processes = await this.getRunningProcesses();
      return processes.some(proc => 
        proc.name.toLowerCase().includes(appName.toLowerCase()) ||
        appName.toLowerCase().includes(proc.name.toLowerCase())
      );
    } catch (err) {
      return false;
    }
  }

  async monitorAndControlProcesses() {
    if (!this.currentSession || !this.isSessionActive) return;

    try {
      const processes = await this.getRunningProcesses();
      
      for (const process of processes) {
        const processName = process.name.toLowerCase();
        
        // Skip system processes
        if (this.isSystemProcess(processName)) {
          continue;
        }
        
        const isBlocked = this.isProcessBlocked(processName);
        const isAllowed = this.isProcessAllowed(processName);
        
        // Block explicitly blocked apps
        if (isBlocked) {
          console.log('Blocked app detected:', processName);
          this.currentSession.blockedAttempts++;
          this.blockedAttempts++;
          await this.forceCloseProcess(process);
          this.showNotification('App Blocked', `${processName} was blocked during focus session`);
        }
        // During session, block non-allowed apps (except system processes)
        else if (!isAllowed) {
          console.log('Non-allowed app detected:', processName);
          this.currentSession.distractions++;
          await this.forceCloseProcess(process);
          this.showNotification('App Restricted', `${processName} is not allowed during focus session`);
        }
      }
    } catch (err) {
      console.error('Monitoring error:', err);
    }
  }

  async getRunningProcesses() {
    return new Promise((resolve, reject) => {
      if (process.platform === 'win32') {
        exec('wmic process get name,processid,executablepath /format:csv', (error, stdout, stderr) => {
          if (error) {
            // Fallback to simpler command
            exec('tasklist /fo csv /nh', (fallbackError, fallbackStdout) => {
              if (fallbackError) {
                reject(fallbackError);
                return;
              }
              
              const processes = [];
              const lines = fallbackStdout.split('\n').filter(line => line.trim());
              
              for (const line of lines) {
                const match = line.match(/"([^"]+)"/);
                if (match && match[1]) {
                  processes.push({
                    name: match[1].replace('.exe', ''),
                    pid: 0,
                    fullName: match[1]
                  });
                }
              }
              
              resolve(processes);
            });
            return;
          }
          
          const processes = [];
          const lines = stdout.split('\n').filter(line => line.trim());
          
          // Skip header line
          for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].split(',');
            if (parts.length >= 3) {
              const execPath = parts[1]?.trim();
              const name = parts[2]?.trim();
              const pid = parts[3]?.trim();
              
              if (name && name !== 'Name') {
                processes.push({
                  name: name.replace('.exe', ''),
                  pid: parseInt(pid) || 0,
                  fullName: name,
                  path: execPath
                });
              }
            }
          }
          
          resolve(processes);
        });
      } else {
        // Unix-like systems
        exec('ps -eo comm,pid,args', (error, stdout, stderr) => {
          if (error) {
            reject(error);
            return;
          }
          
          const processes = [];
          const lines = stdout.split('\n').filter(line => line.trim());
          
          for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].trim().split(/\s+/);
            if (parts.length >= 2) {
              processes.push({
                name: parts[0],
                pid: parseInt(parts[1]),
                fullName: parts[0]
              });
            }
          }
          
          resolve(processes);
        });
      }
    });
  }

  isProcessBlocked(processName) {
    for (const blockedApp of this.blockedProcesses) {
      if (processName.includes(blockedApp) || blockedApp.includes(processName)) {
        return true;
      }
    }
    return false;
  }

  isProcessAllowed(processName) {
    for (const allowedApp of this.allowedProcesses) {
      if (processName.includes(allowedApp) || allowedApp.includes(processName)) {
        return true;
      }
    }
    return false;
  }

  isSystemProcess(processName) {
    const systemProcesses = [
      'system', 'registry', 'smss', 'csrss', 'wininit', 'winlogon',
      'services', 'lsass', 'svchost', 'explorer', 'dwm', 'taskhost',
      'conhost', 'audiodg', 'spoolsv', 'winmgmt', 'wmiprvse',
      'dllhost', 'msiexec', 'rundll32', 'regsvr32', 'wuauclt',
      'searchindexer', 'werfault', 'wermgr', 'taskmgr'
    ];
    
    return systemProcesses.some(sysProc => 
      processName.includes(sysProc) || sysProc.includes(processName)
    );
  }

  async forceCloseProcess(process) {
    try {
      if (process.pid && process.pid > 0) {
        if (process.platform === 'win32') {
          // Try graceful termination first
          exec(`taskkill /pid ${process.pid}`, (error) => {
            if (error) {
              // Force kill if graceful fails
              exec(`taskkill /f /pid ${process.pid}`, (forceError) => {
                if (forceError) {
                  console.log(`Could not force close process ${process.name} (PID: ${process.pid}):`, forceError.message);
                } else {
                  console.log(`Force closed ${process.name} (PID: ${process.pid})`);
                }
              });
            } else {
              console.log(`Gracefully closed ${process.name} (PID: ${process.pid})`);
            }
          });
        } else {
          // Unix-like systems
          exec(`kill ${process.pid}`, (error) => {
            if (error) {
              exec(`kill -9 ${process.pid}`, (forceError) => {
                if (forceError) {
                  console.log(`Could not force close process ${process.name}:`, forceError.message);
                }
              });
            }
          });
        }
      }
    } catch (err) {
      console.error('Error closing process:', err);
    }
  }

  async launchApp(appName) {
    try {
      const cleanAppName = appName.toLowerCase().trim();
      
      if (process.platform === 'win32') {
        // Try different launch methods
        const launchMethods = [
          // Direct executable name
          () => spawn(cleanAppName, [], { detached: true, stdio: 'ignore' }),
          // With .exe extension
          () => spawn(`${cleanAppName}.exe`, [], { detached: true, stdio: 'ignore' }),
          // Using shell command
          () => exec(`start "" "${cleanAppName}"`),
          // Common program locations
          () => exec(`"C:\\Program Files\\${appName}\\${cleanAppName}.exe"`),
          () => exec(`"C:\\Program Files (x86)\\${appName}\\${cleanAppName}.exe"`),
          // Windows store apps and system apps
          () => exec(`explorer shell:AppsFolder\\${cleanAppName}`),
          // Try Windows run command
          () => shell.openExternal(cleanAppName)
        ];
        
        for (let i = 0; i < launchMethods.length; i++) {
          try {
            const child = launchMethods[i]();
            if (child && child.unref) {
              child.unref();
            }
            console.log(`Successfully launched ${appName} using method ${i + 1}`);
            return { success: true, method: i + 1 };
          } catch (err) {
            if (i === launchMethods.length - 1) {
              throw err;
            }
          }
        }
      } else {
        // macOS and Linux
        const child = spawn(cleanAppName, [], { detached: true, stdio: 'ignore' });
        child.unref();
        return { success: true };
      }
      
      return { success: false, error: 'All launch methods failed' };
    } catch (err) {
      console.error('Failed to launch app:', err);
      return { success: false, error: err.message };
    }
  }

  async stopSession() {
    if (!this.currentSession) {
      console.log('No active session to stop');
      return null;
    }
    
    console.log('Stopping focus session');
    
    this.isSessionActive = false;
    
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    
    if (this.sessionTimeout) {
      clearTimeout(this.sessionTimeout);
      this.sessionTimeout = null;
    }
    
    this.currentSession.endTime = Date.now();
    this.currentSession.totalDuration = this.currentSession.endTime - this.currentSession.startTime;
    this.currentSession.blockedAttempts = this.blockedAttempts;
    
    this.sessions.push({ ...this.currentSession });
    await this.saveSessions();
    
    const stoppedSession = this.currentSession;
    this.currentSession = null;
    this.allowedProcesses.clear();
    this.launchedApps.clear();
    
    this.showNotification('Session Complete', 
      `Focus session ended! Duration: ${Math.round(stoppedSession.totalDuration / 60000)} minutes. Apps blocked: ${this.blockedAttempts}`);
    
    this.blockedAttempts = 0;
    return stoppedSession;
  }

  showNotification(title, body) {
    try {
      if (Notification.isSupported()) {
        const notification = new Notification({ 
          title, 
          body,
          silent: false,
          timeoutType: 'default',
          urgency: 'normal'
        });
        notification.show();
        
        // Auto-close notification after 4 seconds
        setTimeout(() => {
          try {
            notification.close();
          } catch (e) {
            // Ignore errors when closing notification
          }
        }, 4000);
      } else {
        console.log('Notification:', title, '-', body);
      }
    } catch (err) {
      console.error('Notification error:', err);
      console.log('Notification fallback:', title, '-', body);
    }
  }

  getSessions() {
    return {
      current: this.currentSession,
      history: this.sessions.slice(-50)
    };
  }

  getBlockList() {
    return [...this.blockedProcesses];
  }

  addToBlockList(appName) {
    this.blockedProcesses.add(appName.toLowerCase());
    this.saveBlockList();
    return true;
  }

  removeFromBlockList(appName) {
    this.blockedProcesses.delete(appName.toLowerCase());
    this.saveBlockList();
    return true;
  }
}

module.exports = FocusManager;
