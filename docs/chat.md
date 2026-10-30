# Chat & Messaging API

Base prefix: `/api/chat`

Handles 1-on-1 direct messaging, group chats, eligibility enforcement between hosts and guests, S3 attachment handling, and real-time Socket.io broadcasting.

---

## 1. Eligibility & Permissions

Hosts and guests are subject to strict messaging eligibility rules:
* Guests can only message hosts if they have an active or completed booking, or under approved pre-booking inquiry conditions.
* Once a journey is finished, 1-on-1 chats are locked.
* Group plans (`isGroup: true`) allow open discussion among all participants.

### 1.1 Check Chat Eligibility
* **Method**: `GET`
* **Path**: `/api/chat/eligibility/:conversationId`
* **Auth**: Required (`checkAuth`)
* **Success Response (200)**:
  ```json
  {
    "success": true,
    "canChat": true,
    "reason": null
  }
  ```

---

## 2. Conversation Management

### 2.1 Get All Conversations
* **Method**: `GET`
* **Path**: `/api/chat/conversations`
* **Auth**: Required (`checkAuth`)
* **Success Response (200)**: Array of 1-on-1 and group conversations sorted by newest update.

---

### 2.2 Create or Get 1-on-1 Conversation
* **Method**: `POST`
* **Path**: `/api/chat/conversations`
* **Auth**: Required (`checkAuth`)
* **Request Body** (`application/json`):
  ```json
  {
    "recipientId": "60d0aa..."
  }
  ```
* **Success Response (200)**: Returns existing or newly initialized conversation document.

---

### 2.3 Create Group Plan
* **Method**: `POST`
* **Path**: `/api/chat/groups`
* **Auth**: Required (`checkAuth`)
* **Request Type**: `multipart/form-data` or `application/json`
* **Parameters**:
  * `name`: `string` (Required)
  * `description`: `string` (Optional)
  * `participantIds`: JSON array or array of user IDs
  * `avatar`: File (Optional image upload, max 3MB)
* **Success Response (201)**: Returns group conversation with admin set to initiator.

---

### 2.4 Update Group Metadata
* **Method**: `PATCH`
* **Path**: `/api/chat/conversations/:conversationId`
* **Auth**: Required (`checkAuth` - Group Admin only)
* **Parameters**: `name`, `description`, `avatar` (file).

---

### 2.5 Leave Group
* **Method**: `POST`
* **Path**: `/api/chat/conversations/:conversationId/leave`
* **Auth**: Required (`checkAuth`)
* **Success Response (200)**: Removes user. If admin leaves, assigns next member as admin. Deletes group if last member leaves.

---

### 2.6 Delete Conversation
* **Method**: `DELETE`
* **Path**: `/api/chat/conversations/:conversationId`
* **Auth**: Required (`checkAuth` - participant or group admin)
* **Success Response (200)**: Deletes conversation and all its messages.

---

## 3. Messages & Attachments

### 3.1 Get Messages for Conversation
* **Method**: `GET`
* **Path**: `/api/chat/messages/:conversationId`
* **Auth**: Required (`checkAuth` - must be participant)
* **Success Response (200)**:
  ```json
  {
    "success": true,
    "messages": [
      {
        "_id": "654c...",
        "conversationId": "654a...",
        "sender": {
          "_id": "60d0fe...",
          "firstname": "John",
          "avatar": { "url": "..." }
        },
        "text": "Hello, is the morning slot available?",
        "attachments": [],
        "messageType": "text",
        "createdAt": "2026-10-19T11:00:00.000Z"
      }
    ]
  }
  ```

---

### 3.2 Send Message (REST Endpoint)
* **Method**: `POST`
* **Path**: `/api/chat/messages`
* **Auth**: Required (`checkAuth`)
* **Request Body** (`application/json`):
  ```json
  {
    "conversationId": "654a...",
    "recipientId": "60d0aa...",
    "text": "See you at the meeting point!",
    "messageType": "text", // "text" | "location" | "system"
    "locationData": {
      "lat": 12.9716,
      "lng": 77.5946,
      "address": "Jetty Point"
    }
  }
  ```
* **Success Response (201)**: Returns created message. Emits Socket.io `new_message` to recipient and `message_sent` to sender.

---

### 3.3 Send Message with Pre-uploaded S3 Attachments
* **Method**: `POST`
* **Path**: `/api/chat/messages/:conversationId/attachments`
* **Auth**: Required (`checkAuth`)
* **Request Body** (`application/json`):
  ```json
  {
    "recipientId": "60d0aa...",
    "text": "Here are the photos of our group",
    "attachments": [
      {
        "url": "https://athithya-bucket.s3.amazonaws.com/chat/img1.jpg",
        "public_id": "chat/img1"
      }
    ]
  }
  ```
* **Success Response (201)**: Message created with attachment array and broadcasted.

---

### 3.4 Mark Conversation as Read
* **Method**: `PATCH`
* **Path**: `/api/chat/conversations/:conversationId/read`
* **Auth**: Required (`checkAuth`)
* **Success Response (200)**: Resets unread counter for current user.

---

### 3.5 Delete Message
* **Method**: `DELETE`
* **Path**: `/api/chat/messages/:messageId`
* **Auth**: Required (`checkAuth` - sender only)
* **Success Response (200)**: Deletes message document.

---

### 3.6 Clear All Messages in Conversation
* **Method**: `DELETE`
* **Path**: `/api/chat/conversations/:conversationId/clear`
* **Auth**: Required (`checkAuth`)
* **Success Response (200)**: Deletes all messages and resets `lastMessage`.

---

## 4. Real-Time Socket.io Events

The server exposes Socket.io on the base URL:
* **Client Emit `join`**: Sends `userId` to join personal notification/chat room and mark presence.
* **Server Broadcast `online_users_list`**: Emitted when user presence changes.
* **Server Emit `new_message`**: Emitted to recipient room with new message payload.
* **Server Emit `message_sent`**: Emitted to sender room for message confirmation.
