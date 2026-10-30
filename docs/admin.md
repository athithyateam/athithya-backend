# Admin Operations API

Base prefix: `/api/admin`

All routes under `/api/admin` strictly enforce administrative authorization:
```javascript
router.use(checkAuth, checkAdmin);
```
Requests must supply a valid JWT with `role: "admin"`.

---

## 1. Dashboard & Platform Statistics

### 1.1 Get System Stats
* **Method**: `GET`
* **Path**: `/api/admin/stats`
* **Auth**: Required (`checkAuth`, `checkAdmin`)
* **Success Response (200)**:
  ```json
  {
    "success": true,
    "stats": {
      "totalUsers": 250,
      "totalHosts": 35,
      "totalGuests": 215,
      "totalExperiences": 48,
      "pendingExperiences": 5,
      "totalBookings": 120,
      "revenue": 345000,
      "activeConversations": 18
    }
  }
  ```

---

## 2. User Management

### 2.1 Get All Users
* **Method**: `GET`
* **Path**: `/api/admin/users`
* **Query Parameters**: `page`, `limit`, `role`, `search`
* **Success Response (200)**: Paginated user list with full profile metadata.

---

### 2.2 Update User
* **Method**: `PATCH`
* **Path**: `/api/admin/users/:id`
* **Request Body**: Updates to user fields (name, email, status).

---

### 2.3 Update User Role
* **Method**: `PATCH`
* **Path**: `/api/admin/users/:id/role`
* **Request Body**:
  ```json
  {
    "role": "host" // "guest" | "host" | "admin"
  }
  ```

---

### 2.4 Delete User
* **Method**: `DELETE`
* **Path**: `/api/admin/users/:id`
* **Success Response (200)**: Deletes user record and cascades cleanup.

---

## 3. Experience Moderation

### 3.1 Get All Experiences
* **Method**: `GET`
* **Path**: `/api/admin/experiences`
* **Success Response (200)**: All experiences across all statuses (`active`, `pending`, `rejected`, `inactive`).

---

### 3.2 Get Pending Experiences
* **Method**: `GET`
* **Path**: `/api/admin/experiences/pending`
* **Success Response (200)**: List of newly submitted host experiences waiting for admin review.

---

### 3.3 Update Experience Status (Approve / Reject)
* **Method**: `PATCH`
* **Path**: `/api/admin/experiences/:id/status`
* **Request Body**:
  ```json
  {
    "status": "active", // "active" | "rejected"
    "adminComment": "Approved after document verification"
  }
  ```

---

### 3.4 Update Experience
* **Method**: `PATCH`
* **Path**: `/api/admin/experiences/:id`
* **Request Body**: Direct administrative edits to experience title, price, or description.

---

### 3.5 Delete Experience
* **Method**: `DELETE`
* **Path**: `/api/admin/experiences/:id`
* **Success Response (200)**: Permanently removes experience document and media.

---

## 4. Bookings Management

* **Get All Bookings**: `GET /api/admin/bookings` (Paginated list with host and guest populated)
* **Update Booking**: `PATCH /api/admin/bookings/:id` (Modify booking status or notes)
* **Delete Booking**: `DELETE /api/admin/bookings/:id` (Cancel/delete booking)

---

## 5. Host Verifications

### 5.1 Get Pending Host Applications
* **Method**: `GET`
* **Path**: `/api/admin/hosts/pending`
* **Success Response (200)**: List of users who submitted ID proofs and are awaiting host verification approval.

---

### 5.2 Update Host Verification Status
* **Method**: `PATCH`
* **Path**: `/api/admin/hosts/:userId/verification`
* **Request Body**:
  ```json
  {
    "status": "approved", // "approved" | "rejected"
    "rejectionReason": "ID document is blurry"
  }
  ```
* **Success Response (200)**: Updates user `hostStatus` and sends confirmation email to host.

---

### 5.3 Host History
* **Method**: `GET`
* **Path**: `/api/admin/host-history`
* **Success Response (200)**: Historical audit log of host verification actions.

---

## 6. Chat Activity Monitoring

* **Get Chat Activity**: `GET /api/admin/chat-activity`
* **Success Response (200)**: High-level metric of conversation counts, active chat rooms, and message volumes.
