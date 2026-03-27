const API_BASE = 'http://localhost:3000';

const chatMessages = document.getElementById('chatMessages');
const messageInput = document.getElementById('messageInput');
const messageForm = document.getElementById('messageInputForm');
const backLinkEl = document.getElementById('backLink');
const instructorToggle = document.getElementById('instructorToggle');
const studentToggle = document.getElementById('studentToggle');
const chatTitle = document.getElementById('chatTitle');

let currentMessageType = 'instructor'; // 'instructor' or 'student'
let allMessages = [];
let userId = '';
let role = '';

function getRole() {
  const roleParam = new URLSearchParams(window.location.search).get('role');
  if (roleParam === 'instructor' || roleParam === 'student') {
    return roleParam;
  }

  if (localStorage.getItem('instructorId')) {
    return 'instructor';
  }

  return 'student';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTime(date) {
  if (!date) return '';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  
  const now = new Date();
  const diffMs = now - d;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  
  return d.toLocaleDateString();
}

async function resolveStudentId() {
  const cachedStudentId = localStorage.getItem('studentId');
  if (cachedStudentId) {
    return cachedStudentId;
  }

  const studentEmail = localStorage.getItem('studentEmail');
  if (!studentEmail) {
    return '';
  }

  try {
    const response = await fetch(`${API_BASE}/api/student-profile?email=${encodeURIComponent(studentEmail)}`);
    if (!response.ok) {
      return '';
    }
    const profile = await response.json();
    if (profile && profile.id) {
      localStorage.setItem('studentId', String(profile.id));
      return String(profile.id);
    }
  } catch (e) {
    console.error('Failed to resolve student ID:', e);
  }

  return '';
}

async function resolveUserId(userRole) {
  if (userRole === 'instructor') {
    return localStorage.getItem('instructorId') || '';
  }
  return resolveStudentId();
}

function renderMessages() {
  if (allMessages.length === 0) {
    const emptyText = role === 'instructor' && currentMessageType === 'student'
      ? 'No sent messages yet'
      : 'No messages yet';
    chatMessages.innerHTML = `<div class="messages-empty"><p>${emptyText}</p></div>`;
    return;
  }

  chatMessages.innerHTML = '';
  
  allMessages.forEach((message, index) => {
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble received';
    
    const time = formatTime(message.created_at);
    const messageText = escapeHtml(message.message);
    
    bubble.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 4px;">
        <div class="bubble-content">${messageText}</div>
        <div class="bubble-time">${time}</div>
      </div>
    `;
    
    chatMessages.appendChild(bubble);
    
    // Animate message appearance
    setTimeout(() => {
      bubble.style.animation = 'slideIn 0.3s ease-out';
    }, index * 100);
  });

  // Scroll to bottom
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function loadMessages() {
  try {
    const endpoint = role === 'instructor' && currentMessageType === 'student'
      ? `${API_BASE}/api/instructor-messages/${encodeURIComponent(userId)}`
      : `${API_BASE}/notifications/${encodeURIComponent(userId)}`;
    const response = await fetch(endpoint);
    if (!response.ok) {
      throw new Error('Failed to load messages');
    }

    const messages = await response.json();
    allMessages = Array.isArray(messages) ? messages : [];
    renderMessages();
  } catch (error) {
    console.error('Error loading messages:', error);
    chatMessages.innerHTML = '<div class="messages-empty"><p>Unable to load messages</p></div>';
  }
}

function updateComposerVisibility() {
  if (role !== 'instructor') {
    messageForm.style.display = 'none';
    return;
  }

  const canSendToStudents = currentMessageType === 'student';
  messageForm.style.display = canSendToStudents ? 'flex' : 'none';
  messageInput.disabled = !canSendToStudents;
  messageInput.placeholder = canSendToStudents
    ? 'Type a message to enrolled students...'
    : 'Switch to Students to send a message';
}

async function sendMessage() {
  const messageText = messageInput.value.trim();
  if (!messageText || role !== 'instructor' || currentMessageType !== 'student') return;

  messageInput.value = '';
  messageInput.disabled = true;

  try {
    const response = await fetch(`${API_BASE}/api/send-message-to-students`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instructorId: userId,
        title: 'Message',
        content: messageText,
        priority: 'normal'
      })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.details || payload.error || 'Failed to send message');
    }

    await loadMessages();
  } catch (error) {
    console.error('Error sending message:', error);
    alert(error.message || 'Failed to send message');
  } finally {
    messageInput.disabled = false;
    messageInput.focus();
  }
}

function updateToggleButtons() {
  instructorToggle.classList.toggle('active', currentMessageType === 'instructor');
  studentToggle.classList.toggle('active', currentMessageType === 'student');
  
  if (role === 'student') {
    chatTitle.textContent = currentMessageType === 'instructor' ? 'Instructor Messages' : 'Student Messages';
  } else {
    chatTitle.textContent = currentMessageType === 'instructor' ? 'Instructor Messages' : 'Sent to Students';
  }

  updateComposerVisibility();
}

// Event Listeners
instructorToggle.addEventListener('click', () => {
  currentMessageType = 'instructor';
  updateToggleButtons();
  loadMessages();
});

studentToggle.addEventListener('click', () => {
  currentMessageType = 'student';
  updateToggleButtons();
  loadMessages();
});

messageForm.addEventListener('submit', (e) => {
  e.preventDefault();
  sendMessage();
});

messageInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Initialize
async function init() {
  role = getRole();
  userId = await resolveUserId(role);

  if (!userId) {
    window.location.href = role === 'instructor' ? 'login.html?role=instructor' : 'login.html?role=student';
    return;
  }

  backLinkEl.href = role === 'instructor' ? 'instructor_home.html' : 'student_home.html';
  
  if (role === 'student') {
    messageForm.style.display = 'none';
    studentToggle.style.display = 'none';
  } else {
    studentToggle.style.display = 'flex';
  }

  updateToggleButtons();
  loadMessages();

  // Refresh messages every 5 seconds
  setInterval(loadMessages, 5000);
}

init();
