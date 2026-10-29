# Group Bookings API

Base prefix: `/api/group-bookings`

Provides collaborative trip planning, tiered discount reservations, bulk friend invitations, and shared booking checkout sessions.

---

## Endpoints

### 1. Create Group Booking Session
* **Method**: `POST`
* **Path**: `/api/group-bookings`
* **Auth**: Required (`checkAuth`)
* **Request Body** (`application/json`):
  ```json
  {
    "postId": "64f1a2b...",
    "invitedUserIds": ["60d0fe...", "60d0ff..."],
    "bookingDate": "2026-12-01",
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
      "initiator": "60d0...",
      "post": "64f1a2b...",
      "status": "planning",
      "invitedPeople": [
        {
          "user": "60d0fe...",
          "status": "pending",
          "invitedAt": "2026-10-25T10:00:00.000Z"
        }
      ]
    }
  }
  ```

---

### 2. Send Friend Invite (Bulk & Single)
* **Method**: `POST`
* **Path**: `/api/group-bookings/send-friend-invite`
* **Auth**: Required (`checkAuth`)
* **Request Body** (`application/json`):
  ```json
  {
    "postId": "64f1a2b...",
    "friendIds": ["60d0fe...", "60d0ff..."],
    "groupBookingId": "652a...", // Optional: append to existing session
    "bookingDate": "2026-12-01",
    "numberOfPeople": 1
  }
  ```
* **Success Response (200)**: Returns updated group booking session and dispatches socket notifications.

---

### 3. Remove Invited Friend
* **Method**: `DELETE` or `POST`
* **Path**: 
  * `DELETE /api/group-bookings/post/:postId/invite/:friendId`
  * `POST /api/group-bookings/post/:postId/invite/:friendId/remove` (Fallback)
* **Auth**: Required (`checkAuth`)

---

### 4. Get My Group Bookings
* **Method**: `GET`
* **Path**: `/api/group-bookings/me`
* **Auth**: Required (`checkAuth`)
* **Success Response (200)**: Returns group booking sessions initiated by the caller.

---

### 5. Get Received Group Invitations
* **Method**: `GET`
* **Path**: `/api/group-bookings/invites`
* **Auth**: Required (`checkAuth`)
* **Success Response (200)**: Returns invitations sent to the caller.

---

### 6. Respond to Group Invitation
* **Method**: `POST`
* **Path**: `/api/group-bookings/:id/respond`
* **Auth**: Required (`checkAuth`)
* **Request Body** (`application/json`):
  ```json
  {
    "status": "accepted" // "accepted" or "rejected"
  }
  ```
* **Success Response (200)**:
  ```json
  {
    "success": true,
    "data": { ... }
  }
  ```

---

### 7. Get Group Booking Session Status
* **Method**: `GET`
* **Path**: `/api/group-bookings/post/:postId/status?groupBookingId=652a...`
* **Auth**: Optional (`checkOptionalAuth`)
* **Success Response (200)**: Returns active planning or confirmed session details, expired status flags, and member payment states.

---

### 8. Cancel Group Booking Session
* **Method**: `DELETE`
* **Path**: `/api/group-bookings/:id`
* **Auth**: Optional/Required
* **Success Response (200)**:
  ```json
  {
    "success": true,
    "message": "Session cancelled"
  }
  ```

---

### 9. Update Group Booking Traveler Count
* **Method**: `PATCH`
* **Path**: `/api/group-bookings/:id`
* **Auth**: Required (`checkAuth`)
* **Request Body** (`application/json`):
  ```json
  {
    "numberOfPeople": 2
  }
  ```
