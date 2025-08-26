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
  
  console.log('App initialized successfully');
});

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
          <button id="browse-apps" class="secondary-btn">Browse Files...</button>
          <button id="detect-apps" class="secondary-btn">Detect Installed Apps</button>
        </div>
        <div id="app-selection-list" style="margin: 10px 0; max-height: 300px; overflow-y: auto;"></div>
        <div style="display: flex; gap: 10px; justify-content: flex-end;">
          <button id="cancel-selection" class="secondary-btn">Cancel</button>
          <button id="confirm-selection" class="primary-btn">Add Selected</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Event handlers
    document.getElementById('detect-apps').addEventListener('click', () => loadDetectedApps(type));
    document.getElementById('browse-apps').addEventListener('click', () => browseForApp(type));
    document.getElementById('cancel-selection').addEventListener('click', () => modal.remove());
    document.getElementById('confirm-selection').addEventListener('click', () => {
      const selectedApps = Array.from(document.querySelectorAll('#app-selection-list input[type="checkbox"]:checked'))
        .map(checkbox => checkbox.value);
      
      if (type === 'allowed') {
        selectedApps.forEach(app => {
          if (!userSelectedApps.includes(app)) {
            userSelectedApps.push(app);
          }
        });
        renderAppList();
        localStorage.setItem('selectedApps', JSON.stringify(userSelectedApps));
      } else {
        selectedApps.forEach(app => {
          if (window.electronAPI && window.electronAPI.addToBlockList) {
            window.electronAPI.addToBlockList(app);
          }
        });
        loadBlockedApps();
      }
      
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

async function loadDetectedApps(type) {
  try {
    const appList = document.getElementById('app-selection-list');
    appList.innerHTML = '<p>Loading applications...</p>';

    if (window.electronAPI && window.electronAPI.getInstalledApps) {
      const apps = await window.electronAPI.getInstalledApps();
      
      if (apps.length === 0) {
        appList.innerHTML = '<p>No applications detected. Try browsing manually.</p>';
        return;
      }

      const currentList = type === 'allowed' ? userSelectedApps : blockedApps;
      
      appList.innerHTML = apps.map(app => `
        <div class="app-selection-item">
          <label>
            <input type="checkbox" value="${app.name}" 
                  ${currentList.includes(app.name) ? 'checked' : ''}>
            <span>${app.displayName || app.name}</span>
          </label>
          <small>${app.path}</small>
        </div>
      `).join('');
    } else {
      appList.innerHTML = '<p>API not available. Please try again.</p>';
    }
  } catch (err) {
    console.error('Failed to load detected apps:', err);
    document.getElementById('app-selection-list').innerHTML = 
      '<p>Error loading applications. Try browsing manually.</p>';
  }
}

async function browseForApp(type) {
  try {
    if (window.electronAPI && window.electronAPI.showAppPicker) {
      const result = await window.electronAPI.showAppPicker();
      if (result && result.app) {
        if (type === 'allowed') {
          if (!userSelectedApps.includes(result.app)) {
            userSelectedApps.push(result.app);
            renderAppList();
            localStorage.setItem('selectedApps', JSON.stringify(userSelectedApps));
          }
        } else {
          if (window.electronAPI && window.electronAPI.addToBlockList) {
            await window.electronAPI.addToBlockList(result.app);
            await loadBlockedApps();
          }
        }
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
  appList.innerHTML = userSelectedApps.map(app => `
    <div class="app-tag" data-app-name="${app}">
      ${app}
      <span class="remove-app" onclick="removeApp('${app}', 'allowed')">×</span>
    </div>
  `).join('');
}

function renderBlockList() {
  const blockList = document.getElementById('block-list');
  blockList.innerHTML = blockedApps.map(app => `
    <div class="app-tag blocked-app" data-app-name="${app}">
      ${app}
      <span class="remove-app" onclick="removeApp('${app}', 'blocked')">×</span>
    </div>
  `).join('');
}

window.removeApp = async (app, type) => {
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
};

async function startSession() {
  const duration = parseInt(document.getElementById('duration-input').value);
  
  if (userSelectedApps.length === 0) {
    alert('Please add at least one allowed application');
    return;
  }

  if (duration < 1 || duration > 240) {
    alert('Please enter a duration between 1 and 240 minutes');
    return;
  }

  try {
    const settings = {
      duration,
      allowedApps: userSelectedApps
    };
    
    if (window.electronAPI && window.electronAPI.startSession) {
      currentSession = await window.electronAPI.startSession(settings);
      
      // Update UI
      document.getElementById('start-btn').style.display = 'none';
      document.getElementById('stop-btn').style.display = 'block';
      document.getElementById('duration-input').disabled = true;
      document.getElementById('add-app-btn').disabled = true;
      
      alert(`Focus session started for ${duration} minutes! Blocking ${blockedApps.length} apps.`);
    } else {
      alert('API not available. Please restart the application.');
    }
    
  } catch (err) {
    console.error('Failed to start session:', err);
    alert('Failed to start session. Please try again.');
  }
}

async function stopSession() {
  try {
    if (window.electronAPI && window.electronAPI.stopSession) {
      await window.electronAPI.stopSession();
      
      // Update UI
      document.getElementById('start-btn').style.display = 'block';
      document.getElementById('stop-btn').style.display = 'none';
      document.getElementById('duration-input').disabled = false;
      document.getElementById('add-app-btn').disabled = false;
      
      currentSession = null;
      
      alert('Focus session stopped!');
    } else {
      alert('API not available. Please restart the application.');
    }
    
  } catch (err) {
    console.error('Failed to stop session:', err);
    alert('Failed to stop session. Please try again.');
  }
}