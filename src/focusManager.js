const { app, Notification } = require('electron');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');

class FocusManager {
  constructor() {
    this.sessions = [];
    this.currentSession = null;
    this.monitorInterval = null;
    this.blockedProcesses = new Set();
    
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
        blockList.forEach(app => this.blockedProcesses.add(app));
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
    
    console.log('Starting focus session:', this.currentSession);
    
    // Start monitoring for blocked apps
    this.monitorInterval = setInterval(() => {
      this.monitorActiveWindows().catch(err => {
        console.error('Monitor focus error:', err);
      });
    }, 3000);

    // Auto-stop after duration
    this.sessionTimeout = setTimeout(() => {
      if (this.currentSession && this.currentSession.id === this.currentSession.id) {
        this.stopSession().catch(err => {
          console.error('Auto-stop error:', err);
        });
      }
    }, settings.duration * 60 * 1000);
    
    return this.currentSession;
  }

  async monitorActiveWindows() {
    if (!this.currentSession) return;

    try {
      // Get list of running processes
      const processes = await this.getRunningProcesses();
      
      // Check each process against block list
      for (const process of processes) {
        const processName = process.toLowerCase();
        const isBlocked = this.isProcessBlocked(processName);
        
        if (isBlocked) {
          console.log('Blocked app detected:', processName);
          this.currentSession.blockedAttempts++;
          this.forceCloseProcess(processName);
          this.showNotification('App Blocked', `Blocked ${processName} from running`);
        }
      }
    } catch (err) {
      console.error('Monitoring error:', err);
    }
  }

  async getRunningProcesses() {
    return new Promise((resolve, reject) => {
      if (process.platform === 'win32') {
        exec('tasklist /fo csv /nh', (error, stdout, stderr) => {
          if (error) {
            reject(error);
            return;
          }
          
          const processes = [];
          const lines = stdout.split('\n').filter(line => line.trim());
          
          for (const line of lines) {
            const match = line.match(/"([^"]+)"/);
            if (match && match[1]) {
              processes.push(match[1].replace('.exe', ''));
            }
          }
          
          resolve(processes);
        });
      } else {
        // Fallback for non-Windows
        resolve([]);
      }
    });
  }

  isProcessBlocked(processName) {
    for (const blockedApp of this.blockedProcesses) {
      if (processName.includes(blockedApp.toLowerCase()) || 
          blockedApp.toLowerCase().includes(processName)) {
        return true;
      }
    }
    return false;
  }

  forceCloseProcess(processName) {
    try {
      if (process.platform === 'win32') {
        exec(`taskkill /f /im "${processName}.exe"`, (error) => {
          if (error) {
            console.log(`Could not close process ${processName}:`, error.message);
          } else {
            console.log(`Successfully closed ${processName}`);
          }
        });
      }
    } catch (err) {
      console.error('Error closing process:', err);
    }
  }

  async stopSession() {
    if (!this.currentSession) {
      console.log('No active session to stop');
      return null;
    }
    
    console.log('Stopping focus session');
    
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
    
    this.sessions.push({ ...this.currentSession });
    await this.saveSessions();
    
    const stoppedSession = this.currentSession;
    this.currentSession = null;
    
    this.showNotification('Session Complete', 
      `Focus session ended! Active time: ${Math.round(stoppedSession.activeTime / 60000)} minutes`);
    
    return stoppedSession;
  }

  showNotification(title, body) {
    try {
      if (Notification.isSupported()) {
        const notification = new Notification({ title, body });
        notification.show();
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