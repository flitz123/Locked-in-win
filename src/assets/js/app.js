let userSelectedApps = [];
let blockedApps = [];
let currentSession = null;

document.addEventListener('DOMContentLoaded', async () => {
  console.log('DOM loaded, initializing app...');
  
  // Initialize theme
  const savedTheme = localStorage.getItem('theme') || 'dark';
  document.getElementById('theme-style').href = `assets/css/themes/${savedTheme}.css`;
  document.getElementById('theme-toggle').checked = savedTheme === 'light';

  // Theme toggle
  document.getElementById('theme-toggle').addEventListener('change', function() {
    const theme = this.checked ? 'light' : 'dark';
    document.getElementById('theme-style').href = `assets/css/themes/${theme}.css`;
    localStorage.setItem('theme', theme);
  });

  // Tab functionality
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      // Remove active class from all tabs
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      
      // Add active class to clicked tab
      btn.classList.add('active');
      document.getElementById(`${btn.dataset.tab}-tab`).classList.add('active');
    });
  });

  // Load saved data
  const savedApps = localStorage.getItem('selectedApps');
  if (savedApps) {
    userSelectedApps = JSON.parse(savedApps);
    renderAppList();
  }

  // Load blocked apps
  await loadBlockedApps();

  // Event listeners
  document.getElementById('add-app-btn').addEventListener('click', () => showAppSelectionDialog('allowed'));
  document.getElementById('add-block-btn').addEventListener('click', () => showAppSelectionDialog('blocked'));
  document.getElementById('start-btn').addEventListener('click', startSession);
  document.getElementById('stop-btn').addEventListener('click', stopSession);
  
  // Add default applications if none exist
  if (userSelectedApps.length === 0) {
    addDefaultApplications();
  }
  
  console.log('App initialized successfully');
});

function addDefaultApplications() {
  const defaultApps = ['notepad', 'calculator', 'msedge', 'chrome', 'firefox'];
  const askForDefaults = confirm('Would you like to add some default allowed applications (Notepad, Calculator, Web Browsers)?');
  
  if (askForDefaults) {
    userSelectedApps = [...defaultApps];
    localStorage.setItem('selectedApps', JSON.stringify(userSelectedApps));
    renderAppList();
  }
}

async function loadBlockedApps() {
  try {
    if (window.electronAPI && window.electronAPI.getBlockList) {
      blockedApps = await window.electronAPI.getBlockList();
      renderBlockList();
    } else {
      console.error('electronAPI not available');
    }
  } catch (err) {
    console.error('Failed to load blocked apps:', err);
  }
}

async function showAppSelectionDialog(type) {
  try {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h3>Select Applications to ${type === 'allowed' ? 'Allow' : 'Block'}</h3>
          <button class="close-modal">&times;</button>
        </div>
        <div style="margin: 10px 0;">
          <button id="browse-apps" class="secondary-btn">📁 Browse Files...</button>
          <button id="detect-apps" class="secondary-btn">🔍 Detect Installed Apps</button>
          <button id="add-manual" class="secondary-btn">✏️ Add Manually</button>
        </div>
        <div id="manual-input" style="display: none; margin: 10px 0;">
          <input type="text" id="manual-app-name" placeholder="Enter application name (e.g., chrome, notepad)" style="width: 70%; padding: 8px;">
          <button id="add-manual-btn" class="secondary-btn" style="width: 25%;">Add</button>
        </div>
        <div id="app-selection-list" style="margin: 10px 0; max-height: 300px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 4px;"></div>
        <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 15px;">
          <button id="cancel-selection" class="secondary-btn">Cancel</button>
          <button id="confirm-selection" class="primary-btn">Add Selected</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Event handlers
    document.getElementById('detect-apps').addEventListener('click', () => loadDetectedApps(type));
    document.getElementById('browse-apps').addEventListener('click', () => browseForApp(type));
    document.getElementById('add-manual').addEventListener('click', () => {
      const manualInput = document.getElementById('manual-input');
      manualInput.style.display = manualInput.style.display === 'none' ? 'block' : 'none';
    });
    
    document.getElementById('add-manual-btn').addEventListener('click', () => {
      const appName = document.getElementById('manual-app-name').value.trim();
      if (appName) {
        addSingleApp(appName, type);
        document.getElementById('manual-app-name').value = '';
      }
    });
    
    document.getElementById('cancel-selection').addEventListener('click', () => modal.remove());
    
    document.getElementById('confirm-selection').addEventListener('click', () => {
      const selectedApps = Array.from(document.querySelectorAll('#app-selection-list input[type="checkbox"]:checked'))
        .map(checkbox => checkbox.value);
      
      selectedApps.forEach(app => addSingleApp(app, type));
      modal.remove();
    });

    document.querySelector('.close-modal').addEventListener('click', () => modal.remove());

    // Load apps initially
    await loadDetectedApps(type);

  } catch (err) {
    console.error('Failed to show app selection:', err);
    alert('Failed to load application selection. Please try again.');
  }
}

async function addSingleApp(appName, type) {
  if (type === 'allowed') {
    if (!userSelectedApps.includes(appName)) {
      userSelectedApps.push(appName);
      renderAppList();
      localStorage.setItem('selectedApps', JSON.stringify(userSelectedApps));
    }
  } else {
    if (window.electronAPI && window.electronAPI.addToBlockList) {
      await window.electronAPI.addToBlockList(appName);
      await loadBlockedApps();
    }
  }
}

async function loadDetectedApps(type) {
  try {
    const appList = document.getElementById('app-selection-list');
    appList.innerHTML = '<div style="padding: 20px; text-align: center;"><p>🔍 Scanning for installed applications...</p></div>';

    if (window.electronAPI && window.electronAPI.getInstalledApps) {
      const apps = await window.electronAPI.getInstalledApps();
      
      if (apps.length === 0) {
        appList.innerHTML = `
          <div style="padding: 20px; text-align: center;">
            <p>❌ No applications detected automatically.</p>
            <p>Try browsing manually or adding applications by name.</p>
          </div>
        `;
        return;
      }

      const currentList = type === 'allowed' ? userSelectedApps : blockedApps;
      
      appList.innerHTML = `
        <div style="padding: 10px; background: var(--bg-color); border-bottom: 1px solid var(--border-color);">
          <strong>Found ${apps.length} applications:</strong>
        </div>
        ${apps.map(app => `
          <label class="app-selection-item">
            <input type="checkbox" value="${app.name}" 
                  ${currentList.includes(app.name) ? 'checked' : ''}>
            <div>
              <div><strong>${app.displayName || app.name}</strong></div>
              <small style="color: var(--text-secondary);">${app.path}</small>
            </div>
          </label>
        `).join('')}
      `;
    } else {
      appList.innerHTML = `
        <div style="padding: 20px; text-align: center;">
          <p>⚠️ API not available. Please try again.</p>
        </div>
      `;
    }
  } catch (err) {
    console.error('Failed to load detected apps:', err);
    document.getElementById('app-selection-list').innerHTML = `
      <div style="padding: 20px; text-align: center;">
        <p>❌ Error loading applications.</p>
        <p>Try browsing manually or adding by name.</p>
      </div>
    `;
  }
}

async function browseForApp(type) {
  try {
    if (window.electronAPI && window.electronAPI.showAppPicker) {
      const result = await window.electronAPI.showAppPicker();
      if (result && result.app) {
        await addSingleApp(result.app, type);
        document.querySelector('.modal')?.remove();
      }
    }
  } catch (err) {
    console.error('Failed to browse for app:', err);
    alert('Failed to select application. Please try again.');
  }
}

function renderAppList() {
  const appList = document.getElementById('app-list');
  if (userSelectedApps.length === 0) {
    appList.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary);">No applications added yet. Click "Add Application" to get started.</div>';
    return;
  }
  
  appList.innerHTML = userSelectedApps.map(app => `
    <div class="app-tag" data-app-name="${app}">
      <span>📱 ${app}</span>
      <span class="remove-app" onclick="removeApp('${app}', 'allowed')" title="Remove ${app}">×</span>
    </div>
  `).join('');
}

function renderBlockList() {
  const blockList = document.getElementById('block-list');
  if (blockedApps.length === 0) {
    blockList.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary);">No applications blocked yet. Add apps that distract you during focus sessions.</div>';
    return;
  }
  
  blockList.innerHTML = blockedApps.map(app => `
    <div class="app-tag blocked-app" data-app-name="${app}">
      <span>🚫 ${app}</span>
      <span class="remove-app" onclick="removeApp('${app}', 'blocked')" title="Remove ${app}">×</span>
    </div>
  `).join('');
}

window.removeApp = async (app, type) => {
  const confirmMessage = `Are you sure you want to remove "${app}" from the ${type === 'allowed' ? 'allowed' : 'blocked'} list?`;
  
  if (confirm(confirmMessage)) {
    if (type === 'allowed') {
      userSelectedApps = userSelectedApps.filter(a => a !== app);
      renderAppList();
      localStorage.setItem('selectedApps', JSON.stringify(userSelectedApps));
    } else {
      if (window.electronAPI && window.electronAPI.removeFromBlockList) {
        await window.electronAPI.removeFromBlockList(app);
        await loadBlockedApps();
      }
    }
  }
};

async function startSession() {
  const duration = parseInt(document.getElementById('duration-input').value);
  
  if (userSelectedApps.length === 0) {
    alert('⚠️ Please add at least one allowed application before starting a focus session.');
    return;
  }

  if (duration < 1 || duration > 240) {
    alert('⚠️ Please enter a duration between 1 and 240 minutes.');
    return;
  }

  if (blockedApps.length === 0) {
    const shouldContinue = confirm('You haven\'t added any blocked applications. The session will only restrict you to the allowed apps. Continue anyway?');
    if (!shouldContinue) return;
  }

  // Confirm session start
  const confirmMessage = `Start focus session?\n\n` +
    `Duration: ${duration} minutes\n` +
    `Allowed apps: ${userSelectedApps.join(', ')}\n` +
    `Blocked apps: ${blockedApps.length}\n\n` +
    `Your allowed apps will be launched automatically and you'll be restricted to only those apps during the session.`;
  
  if (!confirm(confirmMessage)) return;

  try {
    const settings = {
      duration,
      allowedApps: userSelectedApps
    };
    
    if (window.electronAPI && window.electronAPI.startSession) {
      // Show loading state
      const startBtn = document.getElementById('start-btn');
      const originalText = startBtn.textContent;
      startBtn.textContent = '🚀 Starting Session...';
      startBtn.disabled = true;
      
      currentSession = await window.electronAPI.startSession(settings);
      
      // Update UI
      document.getElementById('start-btn').style.display = 'none';
      document.getElementById('stop-btn').style.display = 'block';
      document.getElementById('duration-input').disabled = true;
      document.getElementById('add-app-btn').disabled = true;
      
      // Show success message
      alert(`🎯 Focus session started!\n\nYour allowed apps are being launched. You can now use your desktop normally, but only the selected apps will work.\n\nSession will end automatically in ${duration} minutes.`);
      
      // Minimize the main window to let user focus on their apps
      if (window.electronAPI.minimizeWindow) {
        window.electronAPI.minimizeWindow();
      }
      
    } else {
      alert('❌ API not available. Please restart the application.');
      // Reset button state
      document.getElementById('start-btn').textContent = originalText;
      document.getElementById('start-btn').disabled = false;
    }
    
  } catch (err) {
    console.error('Failed to start session:', err);
    alert('❌ Failed to start focus session. Please try again.');
    
    // Reset button state
    document.getElementById('start-btn').textContent = 'Start Focus Session';
    document.getElementById('start-btn').disabled = false;
  }
}

async function stopSession() {
  const shouldStop = confirm('Are you sure you want to end the focus session early?');
  if (!shouldStop) return;
  
  try {
    if (window.electronAPI && window.electronAPI.stopSession) {
      await window.electronAPI.stopSession();
      
      // Update UI
      document.getElementById('start-btn').style.display = 'block';
      document.getElementById('stop-btn').style.display = 'none';
      document.getElementById('duration-input').disabled = false;
      document.getElementById('add-app-btn').disabled = false;
      
      currentSession = null;
      
    } else {
      alert('❌ API not available. Please restart the application.');
    }
    
  } catch (err) {
    console.error('Failed to stop session:', err);
    alert('❌ Failed to stop focus session. Please try again.');
  }
}

// Handle window visibility changes and session state
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && currentSession) {
    // Main window became visible again, session likely ended
    document.getElementById('start-btn').style.display = 'block';
    document.getElementById('stop-btn').style.display = 'none';
    document.getElementById('duration-input').disabled = false;
    document.getElementById('add-app-btn').disabled = false;
    currentSession = null;
  }
});

// Add keyboard shortcuts
document.addEventListener('keydown', (e) => {
  // Ctrl+Enter to start session
  if (e.ctrlKey && e.key === 'Enter') {
    if (document.getElementById('start-btn').style.display !== 'none') {
      startSession();
    }
  }
  
  // Escape to close modals
  if (e.key === 'Escape') {
    const modal = document.querySelector('.modal');
    if (modal) {
      modal.remove();
    }
  }
});
    
  } catch (err) {
    console.error('Failed to stop session:', err);
    alert('Failed to stop session. Please try again.');
  }
}
