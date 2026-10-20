# Group Schedules API

Base prefix: `/api/schedules`

Coordinates group experience planning sessions, allowing travelers to invite up to 2 friends, track their response status (pending, accepted, declined), and lock in a group before booking.

---

## 1. Group Schedule Endpoints

### 1.1 Create Schedule and Invite Friends
* **Method**: `POST`
* **Path**: `/api/schedules`
* **Auth**: Required (`checkAuth`)
* **Note**: Hosts cannot initiate schedules. Group size (traveler + friends) cannot exceed 3.
* **Request Body** (`application/json`):
  ```json
  {
    "postId": "64f1a2b...",
    "invitedUserIds": ["60d0fe...", "60d0fb..."],
    "bookingDate": "2026-11-05",
    "numberOfPeople": 1
  }
  ```
* **Success Response (201)**:
  ```json
  {
    "success": true,
    "message": "Invites sent",
    "data": {
      "_id": "652a...",
      "initiator": "60d0aa...",
      "post": "64f1a2b...",
      "invitedPeople": [
        {
          "user": "60d0fe...",
          "status": "pending"
        }
      ],
      "status": "planning"
    }
  }
  ```

---

### 1.2 Send Immediate Friend Invite (Bulk Support)
* **Method**: `POST`
* **Path**: `/api/schedules/send-friend-invite`
* **Auth**: Required (`checkAuth`)
* **Request Body** (`application/json`):
  ```json
  {
    "postId": "64f1a2b...",
    "friendIds": ["60d0fe...", "60d0fb..."], // or "friendId"
    "bookingDate": "2026-11-05",
    "scheduleId": "652a...", // Optional: append to existing schedule
    "numberOfPeople": 1
  }
  ```
* **Success Response (200)**: Emits real-time notification via Socket.io and returns populated schedule.

---

### 1.3 Remove Invited Friend
* **Method**: `DELETE` or `POST`
* **Paths**:
  * `DELETE /api/schedules/post/:postId/invite/:friendId`
  * `POST /api/schedules/post/:postId/invite/:friendId/remove` (Fallback)
* **Auth**: Required (`checkAuth`)
* **Success Response (200)**: Removes friend from invitation list and clears invite notification.

---

### 1.4 Get My Initiated Schedules
* **Method**: `GET`
* **Path**: `/api/schedules/me`
* **Auth**: Required (`checkAuth`)
* **Success Response (200)**: Array of group planning sessions initiated by logged-in user.

---

### 1.5 Get Invitations Sent to Me
* **Method**: `GET`
* **Path**: `/api/schedules/invites`
* **Auth**: Required (`checkAuth`)
* **Success Response (200)**: Schedules where current user is in `invitedPeople`.

---

### 1.6 Respond to Group Invitation
* **Method**: `POST`
* **Path**: `/api/schedules/:id/respond`
* **Auth**: Required (`checkAuth`)
* **Request Body** (`application/json`):
  ```json
  {
    "status": "accepted" // "accepted" | "declined"
  }
  ```
* **Success Response (200)**: If all members accept, schedule status transitions to `confirmed`.

---

### 1.7 Get Schedule Status
* **Method**: `GET`
* **Path**: `/api/schedules/post/:postId/status?scheduleId=652a...`
* **Auth**: Optional (`checkOptionalAuth`)
* **Success Response (200)**: Returns active planning or confirmed session for the post, with expiration check (1-hour timeout for pending invites).

---

### 1.8 Update Schedule (Traveler Count)
* **Method**: `PATCH`
* **Path**: `/api/schedules/:id`
* **Auth**: Required (`checkAuth` - Initiator only)
* **Request Body**: `{ "numberOfPeople": 2 }`
* **Success Response (200)**: Updates traveler count ensuring total group doesn't exceed 3.

---

### 1.9 Delete Schedule (Cancel Session)
* **Method**: `DELETE`
* **Path**: `/api/schedules/:id`
* **Auth**: Required (`checkOptionalAuth` - Initiator only)
* **Success Response (200)**: Deletes planning session.
