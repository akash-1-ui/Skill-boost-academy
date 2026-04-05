// ============ CONFIGURATION ============
const API_BASE = 'http://localhost:3000';
const POLLING_INTERVAL = 2000; // 2 seconds
const STUDENT_NOTIFICATIONS_SEEN_PREFIX = 'studentNotificationsLastSeen_';

// ============ DOM ELEMENTS ============
const backLinkEl = document.getElementById('backLink');
const studentsTabBtn = document.getElementById('studentsTabBtn');
const instructorsTabBtn = document.getElementById('instructorsTabBtn');
const panelTabs = document.querySelector('.panel-tabs');
const messagesPageTitle = document.getElementById('messagesPageTitle');
const conversationList = document.getElementById('conversationList');
const conversationTitle = document.getElementById('conversationTitle');
const conversationMeta = document.getElementById('conversationMeta');
const chatMessages = document.getElementById('chatMessages');
const chatInputArea = document.querySelector('.chat-input-area');
const messageForm = document.getElementById('messageInputForm');
const messageInput = document.getElementById('messageInput');
const sendMessageBtn = document.getElementById('sendMessageBtn');

// ============ STATE ============
let user = null;
let userId = '';
let userRole = '';
let userName = '';
let currentTab = 'students';
let messagesList = [];
let isSending = false;
let lastMessageTimestamp = null;
let pollingInterval = null;

function getTimestampMs(value) {
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function getStudentNotificationStorageId() {
  const studentEmail = localStorage.getItem('studentEmail');
  const studentId = localStorage.getItem('studentId');
  return String(studentEmail || studentId || userId || '').trim();
}

function getStudentNotificationSeenKey(feedKey = 'all') {
  const storageId = getStudentNotificationStorageId();
  return storageId ? `${STUDENT_NOTIFICATIONS_SEEN_PREFIX}${storageId}_${feedKey}` : '';
}

function inferMessageCategory(message) {
  const normalized = String(message?.message_category || '').trim().toLowerCase();
  if (normalized === 'new_release' || normalized === 'instructor_message') {
    return normalized;
  }

  return String(message?.message || '').trim().startsWith('NEW RELEASE:')
    ? 'new_release'
    : 'instructor_message';
}

function getStudentFeedKey(tabName = currentTab) {
  return tabName === 'instructor_messages' ? 'instructor_messages' : 'new_releases';
}

function markStudentNotificationsSeen(messages) {
  if (!isStudentUser()) return;

  const storageKey = getStudentNotificationSeenKey(getStudentFeedKey());
  if (!storageKey) return;

  const latestTimestamp = (Array.isArray(messages) ? messages : []).reduce((latest, message) => {
    if (String(message?.role || '').toLowerCase() !== 'instructor') {
      return latest;
    }

    return Math.max(latest, getTimestampMs(message?.timestamp));
  }, 0);

  if (latestTimestamp > 0) {
    localStorage.setItem(storageKey, new Date(latestTimestamp).toISOString());
  }
}

function isPlaceholderName(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return (
    !normalized ||
    normalized === 'anonymous' ||
    normalized === 'anonimous' ||
    normalized === 'user' ||
    normalized === 'student' ||
    normalized === 'instructor'
  );
}

function pickMeaningfulName(candidates, fallback) {
  for (const candidate of candidates) {
    const trimmed = String(candidate || '').trim();
    if (!isPlaceholderName(trimmed)) {
      return trimmed;
    }
  }

  return fallback;
}

function normalizeRole(roleValue) {
  const normalized = String(roleValue || '').trim().toLowerCase();
  if (normalized === 'instructor' || normalized === 'student') {
    return normalized;
  }
  return '';
}

function resolveStoredRole(storedUser) {
  const normalizedUserRole = normalizeRole(storedUser?.role);
  if (normalizedUserRole) {
    return normalizedUserRole;
  }

  if (localStorage.getItem('instructorId')) {
    return 'instructor';
  }

  if (localStorage.getItem('studentId')) {
    return 'student';
  }

  return 'student';
}

function createFallbackUser() {
  const studentId = localStorage.getItem('studentId');
  const studentEmail = localStorage.getItem('studentEmail');
  const instructorId = localStorage.getItem('instructorId');
  const instructorEmail = localStorage.getItem('instructorEmail');

  if (studentId || studentEmail) {
    const studentName = studentEmail
      ? (localStorage.getItem(`studentName_${studentEmail}`) || localStorage.getItem('studentName'))
      : localStorage.getItem('studentName');

    return {
      id: studentId || '',
      role: 'student',
      username: studentName || studentEmail || 'Student',
      email: studentEmail || ''
    };
  }

  if (instructorId || instructorEmail) {
    return {
      id: instructorId || '',
      role: 'instructor',
      username: localStorage.getItem('instructorName') || instructorEmail || 'Instructor',
      email: instructorEmail || ''
    };
  }

  return null;
}

function resolveStoredUser() {
  const userString = localStorage.getItem('user');
  if (userString) {
    try {
      const parsed = JSON.parse(userString);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    } catch (error) {
      console.warn('Stored user is invalid JSON. Falling back to role-specific storage.', error);
    }
  }

  return createFallbackUser();
}

function resolveUserName(storedUser) {
  if (userRole === 'instructor') {
    return pickMeaningfulName(
      [
        localStorage.getItem('instructorName'),
        storedUser?.username,
        storedUser?.name,
        storedUser?.email
      ],
      'Instructor'
    );
  }

  return pickMeaningfulName(
    [
      localStorage.getItem('studentName'),
      storedUser?.username,
      storedUser?.name,
      storedUser?.email
    ],
    'Student'
  );
}

function resolveMessageSenderName(message) {
  return pickMeaningfulName(
    [
      message?.sender_account_name,
      message?.sender_actual_name,
      message?.sender_name,
      message?.instructor_name
    ],
    message?.role === 'instructor' ? 'Instructor' : 'User'
  );
}

function isStudentUser() {
  return userRole === 'student';
}

function canAccessTab(tabName) {
  if (userRole === 'instructor') {
    return tabName === 'students' || tabName === 'instructors';
  }

  return tabName === 'new_releases' || tabName === 'instructor_messages';
}

function getSafeTab(tabName) {
  if (canAccessTab(tabName)) {
    return tabName;
  }

  return isStudentUser() ? 'new_releases' : 'students';
}

function getVisibleGroups() {
  if (isStudentUser()) {
    return [
      {
        tab: 'new_releases',
        title: 'NEW Releases',
        description: 'Fresh course launches and AI release notes'
      },
      {
        tab: 'instructor_messages',
        title: 'Instructor Messages',
        description: 'Direct announcements and updates from instructors'
      }
    ];
  }

  return [
    {
      tab: 'students',
      title: 'Students Group',
      description: 'Messages sent to all students'
    },
    {
      tab: 'instructors',
      title: 'Instructors Group',
      description: 'Messages shared with instructors'
    }
  ];
}

function renderConversationList() {
  if (!conversationList) return;

  const groups = getVisibleGroups();
  conversationList.innerHTML = '';

  const fragment = document.createDocumentFragment();
  groups.forEach((group) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `conversation-item${currentTab === group.tab ? ' active' : ''}`;
    item.dataset.tab = group.tab;
    item.innerHTML = `<h3>${group.title}</h3><p>${group.description}</p>`;
    item.addEventListener('click', () => switchTab(group.tab));
    fragment.appendChild(item);
  });

  conversationList.appendChild(fragment);
}

function configureRoleView() {
  document.title = 'Notifications';

  if (messagesPageTitle) {
    messagesPageTitle.textContent = 'Notifications';
  }

  if (isStudentUser()) {
    panelTabs?.setAttribute('hidden', 'hidden');
    instructorsTabBtn?.setAttribute('hidden', 'hidden');
    instructorsTabBtn?.setAttribute('aria-hidden', 'true');
    instructorsTabBtn?.setAttribute('tabindex', '-1');
  } else {
    panelTabs?.removeAttribute('hidden');
    instructorsTabBtn?.removeAttribute('hidden');
    instructorsTabBtn?.removeAttribute('aria-hidden');
    instructorsTabBtn?.removeAttribute('tabindex');
  }

  renderConversationList();
}

// ============ INITIALIZATION ============
document.addEventListener('DOMContentLoaded', initApp);

async function initApp() {
  try {
    user = resolveStoredUser();
    if (!user) {
      console.warn('No user found, redirecting to login');
      window.location.href = 'login.html';
      return;
    }

    userId = user.id || '';
    userRole = resolveStoredRole(user);
    userName = resolveUserName(user);
    document.body.dataset.role = userRole;
    localStorage.setItem('user', JSON.stringify({
      id: userId,
      role: userRole,
      username: userName,
      email: user.email || ''
    }));

    console.log(`Logged in as: ${userName} (${userRole})`);

    // Setup event listeners
    if (backLinkEl) backLinkEl.addEventListener('click', goBack);
    if (studentsTabBtn) studentsTabBtn.addEventListener('click', () => switchTab('students'));
    if (instructorsTabBtn) instructorsTabBtn.addEventListener('click', () => switchTab('instructors'));
    if (messageForm) messageForm.addEventListener('submit', handleSendMessage);

    configureRoleView();

    // Start with students tab
    await switchTab(getSafeTab(isStudentUser() ? 'new_releases' : 'students'));

  } catch (error) {
    console.error('Init error:', error);
    alert('Error loading messages. Please refresh.');
  }
}

// ============ TAB SWITCHING ============
async function switchTab(tabName) {
  const safeTabName = getSafeTab(tabName);
  if (safeTabName !== tabName) {
    console.warn(`Access denied for ${tabName} tab. Redirecting to ${safeTabName}.`);
  }

  tabName = safeTabName;
  console.log(`Switching to ${tabName} tab`);

  // Update active tab button
  if (tabName === 'students') {
    studentsTabBtn?.classList.add('active');
    instructorsTabBtn?.classList.remove('active');
  } else if (tabName === 'instructors') {
    instructorsTabBtn?.classList.add('active');
    studentsTabBtn?.classList.remove('active');
  }

  currentTab = tabName;
  messagesList = [];
  lastMessageTimestamp = null;

  // Clear existing polling
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }

  // Completely clear chat messages container
  if (chatMessages) {
    chatMessages.innerHTML = '';
  }

  // Remove any existing readonly notices
  document.querySelectorAll('.readonly-notice').forEach(notice => notice.remove());

  // Update UI
  updateTabTitle();
  renderConversationList();
  updateMessageInputState();
  clearMessages();

  // Load messages and start polling
  await loadTabMessages();
  pollingInterval = setInterval(loadTabMessages, POLLING_INTERVAL);
}

// ============ TAB TITLE & META ============
function updateTabTitle() {
  if (isStudentUser()) {
    if (currentTab === 'instructor_messages') {
      conversationTitle.textContent = 'Instructor Messages';
      conversationMeta.textContent = 'Direct instructor announcements and student-facing updates';
    } else {
      conversationTitle.textContent = 'NEW Releases';
      conversationMeta.textContent = 'Fresh course drops and AI release notes';
    }
    return;
  }

  if (currentTab === 'students') {
    conversationTitle.textContent = 'Students Group';
    conversationMeta.textContent = 'Messages visible to all students';
  } else {
    conversationTitle.textContent = 'Instructors Group';
    conversationMeta.textContent = 'Messages visible to all instructors';
  }
}

function getMessageRequestConfig(tabName) {
  if (tabName === 'new_releases') {
    return { groupType: 'students', category: 'new_release' };
  }

  if (tabName === 'instructor_messages') {
    return { groupType: 'students', category: 'instructor_message' };
  }

  return { groupType: getSafeTab(tabName), category: '' };
}

// ============ LOAD MESSAGES FROM API ============
async function loadTabMessages() {
  try {
    const safeTabName = getSafeTab(currentTab);
    if (safeTabName !== currentTab) {
      currentTab = safeTabName;
      updateTabTitle();
      renderConversationList();
    }

    const requestConfig = getMessageRequestConfig(currentTab);
    const query = requestConfig.category
      ? `?category=${encodeURIComponent(requestConfig.category)}`
      : '';

    const response = await fetch(`${API_BASE}/api/group-messages/${requestConfig.groupType}${query}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      }
    });

    if (!response.ok) {
      console.error('Failed to fetch messages');
      return;
    }

    const data = await response.json();
    const fetchedMessages = Array.isArray(data.messages) ? data.messages : [];
    
    // Explicitly clear messagesList before assigning new data
    messagesList = [];
    
    // Filter by category for students to ensure only appropriate messages show
    const categoryFilter = requestConfig.category;
    const filteredByCategory = categoryFilter 
      ? fetchedMessages.filter((msg) => {
          const msgCategory = inferMessageCategory(msg);
          return msgCategory === categoryFilter;
        })
      : fetchedMessages;
    
    messagesList = isStudentUser()
      ? filteredByCategory
          .filter((msg) => String(msg.role || '').toLowerCase() === 'instructor')
          .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      : filteredByCategory;
    
    renderMessages();
    markStudentNotificationsSeen(messagesList);

  } catch (error) {
    console.error('Error loading messages:', error);
  }
}

// ============ HANDLE SEND MESSAGE ============
async function handleSendMessage(e) {
  e.preventDefault();

  // Validate
  const messageText = messageInput?.value?.trim();
  if (!messageText) return;

  if (userRole !== 'instructor') {
    alert('Only instructors can send messages');
    return;
  }

  isSending = true;
  sendMessageBtn.disabled = true;

  try {
    const response = await fetch(`${API_BASE}/api/group-messages/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender_id: userId,
        sender_name: userName,
        role: userRole,
        group_type: currentTab,
        message: messageText
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      alert(errorData.error || 'Failed to send message');
      return;
    }

    // Clear input
    if (messageInput) messageInput.value = '';

    // Reload messages
    await loadTabMessages();

    // Auto-scroll to bottom
    scrollToBottom();

  } catch (error) {
    console.error('Error sending message:', error);
    alert('Error sending message. Please try again.');
  } finally {
    isSending = false;
    sendMessageBtn.disabled = false;
  }
}

// ============ RENDER MESSAGES ============
function renderMessages() {
  if (!chatMessages) return;

  if (isStudentUser()) {
    renderStudentNotifications();
    return;
  }

  const fragment = document.createDocumentFragment();

  messagesList.forEach((msg) => {
    // Create message group (sender name + bubble)
    const messageGroup = document.createElement('div');
    messageGroup.className = 'message-group';

    const senderNameEl = document.createElement('div');
    senderNameEl.className = 'message-sender-name';
    senderNameEl.textContent = resolveMessageSenderName(msg);
    messageGroup.appendChild(senderNameEl);

    // Message bubble
    const bubble = document.createElement('div');
    bubble.className = `message-bubble ${msg.role}`;

    // Message text
    const textDiv = document.createElement('div');
    textDiv.className = 'message-bubble-text';
    textDiv.textContent = msg.message;

    // Timestamp
    const timeDiv = document.createElement('div');
    timeDiv.className = 'message-bubble-time';
    timeDiv.textContent = formatTime(msg.timestamp);

    bubble.appendChild(textDiv);
    bubble.appendChild(timeDiv);
    messageGroup.appendChild(bubble);

    fragment.appendChild(messageGroup);
  });

  // Replace container content
  chatMessages.innerHTML = '';
  if (messagesList.length === 0) {
    const emptyMessage = 'No messages yet. Be the first to send one!';
    chatMessages.innerHTML = `<div class="empty-state"><div class="empty-state-text">${emptyMessage}</div></div>`;
  } else {
    chatMessages.appendChild(fragment);
    scrollToBottom();
  }
}

function renderStudentNotifications() {
  chatMessages.innerHTML = '';

  const emptyMessage = currentTab === 'instructor_messages'
    ? 'No instructor messages yet.'
    : 'No new releases yet.';

  if (messagesList.length === 0) {
    chatMessages.innerHTML = `<div class="empty-state"><div class="empty-state-text">${emptyMessage}</div></div>`;
    return;
  }

  const fragment = document.createDocumentFragment();

  messagesList.forEach((msg) => {
    const messageGroup = document.createElement('article');
    messageGroup.className = 'message-group student-notification-group';

    const sender = document.createElement('div');
    sender.className = 'message-sender-name student-notification-sender';
    sender.textContent = resolveMessageSenderName(msg);

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble instructor student-notification-bubble';

    const time = document.createElement('time');
    time.className = 'message-bubble-time student-notification-time';
    time.dateTime = msg.timestamp || '';
    time.textContent = formatNotificationTimestamp(msg.timestamp);

    const content = document.createElement('p');
    content.className = 'message-bubble-text student-notification-text';
    content.textContent = msg.message || '';

    bubble.appendChild(content);
    bubble.appendChild(time);
    messageGroup.appendChild(sender);
    messageGroup.appendChild(bubble);
    fragment.appendChild(messageGroup);
  });

  chatMessages.appendChild(fragment);
  chatMessages.scrollTop = 0;
}

// ============ UPDATE INPUT STATE ============
function updateMessageInputState() {
  if (!messageInput || !sendMessageBtn || !chatInputArea) return;

  if (isStudentUser()) {
    chatInputArea.hidden = true;
    chatInputArea.setAttribute('aria-hidden', 'true');
    messageInput.disabled = true;
    sendMessageBtn.disabled = true;
    messageInput.setAttribute('aria-disabled', 'true');
    sendMessageBtn.setAttribute('aria-disabled', 'true');
    
    // Add readonly notice
    if (!document.querySelector('.readonly-notice')) {
      const notice = document.createElement('div');
      notice.className = 'readonly-notice';
      notice.textContent = currentTab === 'instructor_messages'
        ? 'Students can read instructor announcements here.'
        : 'Students can read new course releases here.';
      chatMessages?.parentElement?.appendChild(notice);
    } else {
      const notice = document.querySelector('.readonly-notice');
      if (notice) {
        notice.textContent = currentTab === 'instructor_messages'
          ? 'Students can read instructor announcements here.'
          : 'Students can read new course releases here.';
      }
    }
  } else {
    chatInputArea.hidden = false;
    chatInputArea.removeAttribute('aria-hidden');
    messageInput.disabled = false;
    sendMessageBtn.disabled = false;
    messageInput.removeAttribute('aria-disabled');
    sendMessageBtn.removeAttribute('aria-disabled');

    // Remove readonly notice
    document.querySelector('.readonly-notice')?.remove();
  }
}

// ============ CLEAR MESSAGES ============
function clearMessages() {
  if (chatMessages) {
    chatMessages.innerHTML = '<div style="text-align: center; color: #999; padding: 20px;">Loading messages...</div>';
  }
}

// ============ SCROLL TO BOTTOM ============
function scrollToBottom() {
  if (chatMessages) {
    setTimeout(() => {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }, 0);
  }
}

// ============ FORMAT TIMESTAMP ============
function formatTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function formatNotificationTimestamp(timestamp) {
  if (!timestamp) return '';

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';

  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

// ============ GO BACK ============
function goBack() {
  if (userRole === 'instructor') {
    window.location.href = 'instructor_home.html';
  } else {
    window.location.href = 'student_home.html';
  }
}

// ============ CLEANUP ============
window.addEventListener('beforeunload', () => {
  if (pollingInterval) {
    clearInterval(pollingInterval);
  }
});
