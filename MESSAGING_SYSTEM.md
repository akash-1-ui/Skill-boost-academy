# Real-Time Messaging System Documentation

## 📚 Overview

A production-level, real-time messaging system built with **Socket.io**, **Node.js/Express**, and **MySQL**. Features WhatsApp-like UI with real-time messaging, online status, typing indicators, and message delivery tracking.

---

## ✨ Features

### Core Messaging
- ✅ **Real-time Messages**: Instant message delivery via Socket.io
- ✅ **One-to-One Chats**: Direct instructor ↔ instructor or student ↔ instructor messaging
- ✅ **Broadcast Messages**: Instructor → All Students (one-to-many)
- ✅ **Message History**: Persistent message storage in MySQL
- ✅ **Message Search**: Find conversations by name/content

### Real-Time Features
- 🟢 **Online/Offline Status**: Live presence indicators with green dot
- ⌨️ **Typing Indicators**: See when someone is typing
- ✓ **Message Status**: Sent → Delivered → Seen tracking
- 📍 **Last Seen**: Track user's last activity timestamp
- 🔔 **Unread Badges**: Count unread messages per conversation

### User Experience
- 🎨 **WhatsApp-like UI**: Modern dark theme with cyan accents
- 📱 **Responsive Design**: Works on desktop and mobile
- 🔍 **Search & Filter**: Quick conversation search
- 💬 **Auto-scroll**: Messages auto-scroll to latest
- ⚡ **Smooth Animations**: Professional transitions and effects

---

## 🏗️ Architecture

### Database Schema

```sql
-- Users table (existing)
users(id, username, email, role, ...)

-- Conversations
conversations(
  id, 
  conversation_type[one_to_one|broadcast],
  participant1_id, participant2_id,
  broadcast_from_id,
  created_at, updated_at
)

-- Messages
messages(
  id, conversation_id, sender_id,
  message, status[sent|delivered|seen],
  created_at
)

-- Message Reads (who saw what)
message_reads(message_id, user_id, read_at)

-- User Status
user_status(user_id, is_online, last_seen)
```

### Socket.io Rooms

```
User Level:
  - user:{userId} - Direct user connection

Conversation Level:
  - conversation:{conversationId} - All users in conversation

Broadcast:
  - broadcast:all_students - All students receive messages
```

### Event Flow

```
CLIENT:
  user:join
    → SERVER marks user online
    → broadcasts user:online to others
    → sends user:online-list to newly connected

MESSAGE SENDING:
  message:send
    → SERVER inserts to database
    → saves to conversation database
    → broadcasts message:received to room
    → sends message:delivered to recipients
    (if recipient viewing) → message:seen

TYPING:
  user:typing
    → broadcasts typing indicator in room
  user:stopped-typing
    → clears typing indicator
```

---

## 🚀 Setup Guide

### 1. Backend Setup

#### Install Dependencies
```bash
cd backend
npm install
# Socket.io should already be in package.json
```

#### Environment Variables (.env)
```
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=@inspiron16H
DB_NAME=course_registration
PORT=3000
NODE_ENV=development
```

#### Start Server
```bash
npm start
# Server starts on http://localhost:3000
# Socket.io available at ws://localhost:3000
```

### 2. Database Setup

The system automatically creates tables on first run:
- `conversations` - Chat groups/conversations
- `messages` - All messages
- `message_reads` - Message seen tracking
- `user_status` - Online status tracking

No manual SQL needed—tables auto-migrate!

### 3. Frontend Setup

The messaging HTML is at: `/HTML/notifications.html`

Key files:
- `HTML/notifications.html` - WhatsApp-like UI
- `CSS/notifications.css` - Styling (built into HTML)
- `js/notifications.js` - Socket.io client + logic

Access via:
```
http://localhost:3000/HTML/notifications.html
```

---

## 🔌 Socket.io Events Reference

### Server Listening Events

#### User Management
```javascript
socket.on('user:join', (data) => {})
  // data: { userId, userName, userRole, userEmail }
  // Response: broadcasts user:online
```

#### Messaging
```javascript
socket.on('message:send', (data) => {})
  // data: { conversationId, message, messageType }
  // Emits: message:received → all users in room

socket.on('message:seen', (data) => {})
  // data: { conversationId, messageId }
  // Updates message status to 'seen'

socket.on('conversations:get', (data) => {})
  // data: { userId }
  // Response: conversations:list

socket.on('messages:get', (data) => {})
  // data: { conversationId, limit, offset }
  // Response: messages:history
```

#### Typing
```javascript
socket.on('user:typing', (data) => {})
socket.on('user:stopped-typing', (data) => {})
  // Broadcasts to conversation room
```

#### Conversation Management
```javascript
socket.on('conversation:join', (data) => {})
socket.on('conversation:leave', (data) => {})
socket.on('conversation:create', (data) => {})
  // data: { conversationType, participant1Id, participant2Id, ... }
```

### Client Listening Events

```javascript
socket.on('message:received', (msg) => {})
  // msg: { id, conversationId, senderId, message, status, createdAt }

socket.on('message:delivered', (data) => {})
socket.on('message:seen', (data) => {})
  // Update UI with delivery status

socket.on('user:online', (user) => {})
socket.on('user:offline', (user) => {})
socket.on('user:online-list', (users) => {})
  // Update online status indicators

socket.on('user:typing', (data) => {})
socket.on('user:stopped-typing', (data) => {})
  // Show/hide typing indicator

socket.on('conversation:created', (conv) => {})
  // New conversation was created
```

---

## 📡 REST API Endpoints

### Getting Users
```
GET /api/messaging/users?role=instructor
GET /api/messaging/users?role=student

Response:
{
  "users": [
    { id, name, email, role, avatar }
  ]
}
```

### User Profile
```
GET /api/messaging/profile?email=user@example.com

Response:
{ id, name, email, role, avatar }
```

### Conversations
```
GET /api/messaging/conversations?userId=123
POST /api/messaging/conversations

POST body:
{
  "conversationType": "one_to_one",
  "participant1Id": 1,
  "participant2Id": 2
}

Response: { id: conversationId }
```

### Messages
```
GET /api/messaging/messages/:conversationId?limit=50&offset=0

Response:
{
  "messages": [
    { id, conversationId, senderId, senderName, message, status, createdAt }
  ]
}
```

### User Status
```
GET /api/messaging/status/:userId

Response:
{ isOnline: boolean, lastSeen: timestamp }
```

---

## 💻 Frontend Implementation

### Initialize Messaging

```javascript
// notifications.js automatically handles:
// 1. Get current user from localStorage/API
// 2. Connect to Socket.io
// 3. Load conversations
// 4. Setup event listeners
// 5. Setup modal for new chats

initialize()  // Called on page load
```

### Send Message

```javascript
socket.emit('message:send', {
  conversationId: currentConversation.id,
  message: "Hello!",
  messageType: 'text'
});

// Automatically:
// - Saves to database
// - Broadcasts to room
// - Updates UI
// - Sends delivery notification
```

### Create Conversation

```javascript
// Click "➕" button → Modal shows users
// Click user → startConversation(user)
// → Creates one-to-one or uses existing
// → Opens chat
```

---

## 🔒 User Roles & Permissions

### Instructor
- ✅ One-to-one chat with other instructors
- ✅ One-to-one chat with students
- ✅ Broadcast messages to all students
- ✅ View student online status
- ✅ Create new conversations

### Student
- ✅ One-to-one chat with instructors
- ✅ Receive broadcast messages from instructors
- ✅ View instructor online status
- ❌ Cannot message other students
- ❌ Cannot broadcast messages

---

## 🐛 Debugging

### Check Socket.io Connection
```javascript
// Console logs:
// "✅ Connected to socket server"
// "🟢 User joined messaging"

// If not connected:
console.log(socket.connected)  // true/false
socket.io.engine.transport.name  // 'websocket' or 'polling'
```

### Check Messages Sending
```javascript
// Browser DevTools → Network tab
// Look for "/socket.io/" requests
// Should see message:send events

// Server logs:
// "📨 Message sent: {id} in conversation {convId}"
```

### Database Check
```sql
SELECT * FROM conversations LIMIT 10;
SELECT * FROM messages LIMIT 10;
SELECT * FROM user_status;
```

---

## 📊 Performance Considerations

### Database Optimization
- ✅ Indexes on: conversation_type, participants, created_at
- ✅ Message pagination (limit 50 by default)
- ✅ Message reads only update when necessary
- ✅ User status cached in memory (activeUsers Map)

### Socket.io Optimization
- ✅ Uses rooms for targeted broadcasting
- ✅ Limits reconnection attempts
- ✅ Supports both WebSocket and polling fallback
- ✅ Message batching in UI (no individual re-renders)

### Frontend Optimization
- ✅ Message list: max 50 shown (lazy load on scroll)
- ✅ Conversations: max 100 shown
- ✅ DOM elements: reused, not recreated
- ✅ Debounced search/typing indicators

---

## 🛠️ Troubleshooting

### "User not authenticated. Redirecting to login"
**Fix**: Store user in localStorage before visiting messages page
```javascript
localStorage.setItem('user', JSON.stringify({
  id: 1,
  name: 'John',
  email: 'john@example.com',
  role: 'instructor',
  avatar: '/avatar.jpg'
}));
```

### Messages not appearing
1. Check browser console for errors
2. Verify Socket.io connected: `socket.connected === true`
3. Check server logs for "Message sent:"
4. Verify database: `SELECT * FROM messages WHERE conversation_id = 123;`

### Status not updating
- Clear browser cache
- Refresh page to get latest online list
- Check `user_status` table in database

### Typing indicator not showing
- Ensure Socket.io is connected
- Check `user:typing` events in Network tab
- Verify `currentConversation` is set

---

## 📝 Example Usage Flow

### Instructor Starts Conversation with Student

1. **Login** → User object stored in localStorage
2. **Click "➕"** → Modal opens with student list
3. **Click Student Name** → Conversation created via REST API
4. **Type Message** → "Hey! Can you help?" 
5. **Press Enter** → Vue.emit('message:send')
   - Saves to database
   - Other user gets real-time notification
   - Message status: sent → delivered → seen
6. **Typing Indicator** → Other user sees dots while you type
7. **Online Status** → Green dot shows if they're online

### Broadcast Message to All Students

1. **Role**: Must be instructor
2. **Create Broadcast Conversation**:
   ```javascript
   fetch('/api/messaging/conversations', {
     method: 'POST',
     body: JSON.stringify({
       conversationType: 'broadcast',
       broadcastFromId: instructorId
     })
   })
   ```
3. **Send Message** → All students in `broadcast:all_students` room receive it
4. **No replies** → One-way broadcast

---

## 🎯 Future Enhancements

- 📁 File/Image sharing
- 🔍 Message search across all chats
- 📌 Pinned/Starred messages
- 🔕 Notification sounds & desktop notifications
- 🌀 Encryption for privacy
- 👥 Group chats (not just broadcast)
- 🎙️ Voice messages
- 📞 Voice/Video calls
- ⏰ Message scheduling
- 😊 Emoji picker
- 🔗 Rich message formatting

---

## 📞 Support

For issues or questions:
1. Check browser DevTools Console for errors
2. Check server logs: `npm start` output
3. Verify database connection: `node backend/db.js`
4. Ensure port 3000 is not in use: `netstat -ano | findstr :3000`

---

**Version**: 1.0.0  
**Last Updated**: 2024  
**Status**: Production Ready ✅
