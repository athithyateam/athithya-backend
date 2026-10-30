# Notifications API

Base prefix: `/api/notifications`

Manages in-app notifications, unread counters, booking alerts, and follow notifications.

---

## 1. Notification Queries

### 1.1 Get My Notifications
* **Method**: `GET`
* **Path**: `/api/notifications`
* **Auth**: Required (`checkAuth`)
* **Query Parameters**:
  * `page`: `number` (default: 1)
  * `limit`: `number` (default: 20)
  * `unreadOnly`: `"true"` | `"false"`
* **Success Response (200)**:
  ```json
  {
    "success": true,
    "count": 10,
    "total": 35,
    "unreadCount": 4,
    "page": 1,
    "notifications": [
      {
        "_id": "651a...",
        "recipient": "60d0fe...",
        "sender": {
          "_id": "60d0aa...",
          "firstname": "Jane",
          "lastname": "Host",
          "avatar": { "url": "..." }
        },
        "title": "Booking Accepted",
        "message": "Your booking for Sunset Kayaking has been accepted!",
        "type": "booking_accepted",
        "link": "/bookings/64f9d...",
        "read": false,
        "createdAt": "2026-10-19T10:15:30.000Z"
      }
    ]
  }
  ```

---

### 1.2 Get Booking Notifications
* **Method**: `GET`
* **Path**: `/api/notifications/bookings`
* **Auth**: Required (`checkAuth`)
* **Description**: Returns only booking-related notifications (`booking_request`, `booking_accepted`, `booking_declined`, `booking_cancelled`).

---

### 1.3 Get Follow Notifications
* **Method**: `GET`
* **Path**: `/api/notifications/follows`
* **Auth**: Required (`checkAuth`)
* **Description**: Returns only social follow notifications (`type: 'follow'`).

---

## 2. Notification Actions

### 2.1 Create Notification (Internal / Testing)
* **Method**: `POST`
* **Path**: `/api/notifications`
* **Auth**: Required (`checkAuth`)
* **Request Body** (`application/json`):
  ```json
  {
    "recipientId": "60d0fe...",
    "title": "Important Update",
    "message": "Trip departure time adjusted by 30 mins",
    "type": "info", // "info" | "booking_request" | "booking_accepted" | "invite_sent" | "follow"
    "link": "/experiences/64f1..."
  }
  ```
* **Success Response (201)**: Returns created notification.

---

### 2.2 Mark Notification as Read
* **Method**: `PUT`
* **Path**: `/api/notifications/:id/read`
* **Auth**: Required (`checkAuth`)
* **Success Response (200)**: Updates `read: true` for the notification.

---

### 2.3 Mark All Notifications as Read
* **Method**: `PUT`
* **Path**: `/api/notifications/mark-all/read`
* **Auth**: Required (`checkAuth`)
* **Success Response (200)**:
  ```json
  {
    "success": true,
    "message": "All notifications marked as read"
  }
  ```

---

### 2.4 Delete Notification
* **Method**: `DELETE`
* **Path**: `/api/notifications/:id`
* **Auth**: Required (`checkAuth`)
* **Success Response (200)**: Deletes single notification.

---

### 2.5 Clear All Notifications
* **Method**: `DELETE`
* **Path**: `/api/notifications/clear/all`
* **Auth**: Required (`checkAuth`)
* **Success Response (200)**: Deletes all notifications for the authenticated user.
