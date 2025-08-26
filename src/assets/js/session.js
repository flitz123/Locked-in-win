let sessionSettings = null;
let timerInterval = null;
let remainingTime = 0;
let blockedAttempts = 0;

document.addEventListener('DOMContentLoaded', () => {
  console.log('Session window loaded');
  
  // Set up event listeners
  document.getElementById('stop-session-btn').addEventListener('click', stopSession);
  
  // Listen for session start event from main process
  window.electronAPI.onSessionStarted((event, settings) => {
    console.log('Session started with settings:', settings);
    sessionSettings = settings;
    remainingTime = settings.duration * 60; // Convert to seconds
    startTimer();
    populateApps(settings.allowedApps);
  });
});

function startTimer() {
  // Clear any existing timer
  if (timerInterval) {
    clearInterval(timerInterval);
  }
  
  // Update timer immediately
  updateTimerDisplay();
  
  // Set up timer interval
  timerInterval = setInterval(() => {
    remainingTime--;
    updateTimerDisplay();
    
    if (remainingTime <= 0) {
      clearInterval(timerInterval);
      stopSession();
    }
  }, 1000);
}

function updateTimerDisplay() {
  const minutes = Math.floor(remainingTime / 60);
  const seconds = remainingTime % 60;
  document.getElementById('timer').textContent = 
    `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function populateApps(allowedApps) {
  const appGrid = document.getElementById('app-grid');
  appGrid.innerHTML = '';
  
  allowedApps.forEach(appName => {
    const appButton = document.createElement('button');
    appButton.className = 'app-button';
    appButton.innerHTML = `
      <div class="app-icon">📱</div>
      <div class="app-name">${appName}</div>
    `;
    
    appButton.addEventListener('click', () => {
      launchApp(appName);
    });
    
    appGrid.appendChild(appButton);
  });
}

async function launchApp(appName) {
  try {
    const result = await window.electronAPI.launchApp(appName);
    if (!result.success) {
      console.error('Failed to launch app:', result.error);
    }
  } catch (err) {
    console.error('Error launching app:', err);
  }
}

async function stopSession() {
  try {
    await window.electronAPI.stopSession();
    window.close(); // Close the session window
  } catch (err) {
    console.error('Error stopping session:', err);
  }
}

// Update blocked attempts count
function updateBlockedAttempts(count) {
  blockedAttempts = count;
  document.getElementById('blocked-count').textContent = count;
}

// Clean up when window is closed
window.addEventListener('beforeunload', () => {
  if (window.electronAPI) {
    window.electronAPI.removeAllListeners('session-started');
  }
});