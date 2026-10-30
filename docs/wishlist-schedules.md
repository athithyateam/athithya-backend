# Wishlist Schedules API

Base prefix: `/api/wishlist-schedules`

Allows guests to save and schedule specific dates/times for experiences they plan to take. Background workers run periodic reminders for these wishlist items.

---

## Endpoints

### 1. Create or Update Wishlist Schedule
* **Method**: `POST`
* **Path**: `/api/wishlist-schedules`
* **Auth**: Required (`checkAuth`)
* **Note**: Hosts cannot schedule experiences; only guests can. Date and time must be in the future.
* **Request Body** (`application/json`):
  ```json
  {
    "experienceId": "64f1a2b...",
    "scheduledDate": "2026-11-15", // Format: YYYY-MM-DD
    "scheduledTime": "14:30" // Format: HH:mm (24-hour)
  }
  ```
* **Success Response (200)**:
  ```json
  {
    "success": true,
    "message": "Experience scheduled successfully!",
    "schedule": {
      "_id": "653b...",
      "user": "60d0fe...",
      "experience": {
        "_id": "64f1a2b...",
        "title": "Sunset Kayaking",
        "photos": [ ... ],
        "price": { ... }
      },
      "scheduledDate": "2026-11-15",
      "scheduledTime": "14:30",
      "scheduledDateTime": "2026-11-15T09:00:00.000Z",
      "status": "scheduled"
    }
  }
  ```

---

### 2. Get My Active Scheduled Wishlist Items
* **Method**: `GET`
* **Path**: `/api/wishlist-schedules/me`
* **Auth**: Required (`checkAuth`)
* **Success Response (200)**:
  ```json
  {
    "success": true,
    "schedules": [
      {
        "_id": "653b...",
        "experience": { ... },
        "scheduledDateTime": "2026-11-15T09:00:00.000Z",
        "status": "scheduled"
      }
    ]
  }
  ```

---

### 3. Check Wishlist Schedule Status for Experience
* **Method**: `GET`
* **Path**: `/api/wishlist-schedules/check/:experienceId`
* **Auth**: Required (`checkAuth`)
* **Success Response (200)**:
  ```json
  {
    "success": true,
    "isScheduled": true,
    "schedule": { ... }
  }
  ```

---

### 4. Delete / Unschedule Experience
* **Method**: `DELETE`
* **Path**: `/api/wishlist-schedules/:id`
* **Auth**: Required (`checkAuth`)
* **Success Response (200)**:
  ```json
  {
    "success": true,
    "message": "Experience unscheduled successfully"
  }
  ```
