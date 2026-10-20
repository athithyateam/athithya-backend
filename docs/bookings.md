# Bookings & Payments API

Base prefix: `/api/bookings`

Manages experience reservations, Razorpay order creation and payment verification, host confirmation workflows, and journey start/completion OTP verification.

---

## 1. Booking Creation & Payment

### 1.1 Create Booking & Initiate Razorpay Order
* **Method**: `POST`
* **Path**: `/api/bookings`
* **Auth**: Required (`checkAuth`)
* **Note**: Hosts cannot book other experiences.
* **Request Body** (`application/json`):
  ```json
  {
    "postId": "64f1a2b...",
    "numberOfPeople": 2, // 1 to 3 travelers allowed
    "startDate": "2026-11-01",
    "endDate": "2026-11-01",
    "selectedTime": "10:00 AM",
    "guestMessage": "Looking forward to this experience!",
    "invitedUserIds": ["60d0fe4..."], // Optional: IDs of invited friends
    "scheduleId": "64f9c1..." // Optional: Linked group planning schedule ID
  }
  ```
* **Success Response (200)**:
  ```json
  {
    "success": true,
    "booking": {
      "_id": "64f9d...",
      "post": "64f1a2b...",
      "guest": "60d0fe...",
      "host": "60d0aa...",
      "amount": 2400,
      "platformFee": 120,
      "totalAmount": 2520,
      "status": "pending_payment"
    },
    "razorpayOrder": {
      "id": "order_NxYz12345",
      "amount": 252000, // In paise
      "currency": "INR"
    }
  }
  ```

---

### 1.2 Verify Razorpay Payment Signature
* **Method**: `POST`
* **Path**: `/api/bookings/verify`
* **Auth**: Required (`checkAuth`)
* **Request Body** (`application/json`):
  ```json
  {
    "bookingId": "64f9d...",
    "razorpay_order_id": "order_NxYz12345",
    "razorpay_payment_id": "pay_NxYz67890",
    "razorpay_signature": "e5b128c7f99..."
  }
  ```
* **Success Response (200)**:
  ```json
  {
    "success": true,
    "message": "Payment verified and booking confirmed",
    "booking": {
      "_id": "64f9d...",
      "status": "confirmed",
      "paymentStatus": "paid"
    }
  }
  ```

---

## 2. Booking Queries

### 2.1 Get Host Booking Requests
* **Method**: `GET`
* **Path**: `/api/bookings/host/requests`
* **Auth**: Required (`checkAuth` - Host only)
* **Success Response (200)**: Returns requests received by the logged-in host.

---

### 2.2 Get Guest's Own Bookings
* **Method**: `GET`
* **Path**: `/api/bookings/guest/my-bookings`
* **Auth**: Required (`checkAuth`)
* **Success Response (200)**: Array of trips booked by the logged-in guest.

---

### 2.3 Get Booking Details
* **Method**: `GET`
* **Path**: `/api/bookings/:bookingId`
* **Auth**: Required (`checkAuth`)
* **Success Response (200)**: Complete booking details with populated post and user info.

---

## 3. Host Action Endpoints

* **Accept Booking**: `PATCH /api/bookings/:bookingId/accept` (Host only)
* **Decline Booking**: `PATCH /api/bookings/:bookingId/decline` (Host only)
* **Accept Orphaned Booking**: `PATCH /api/bookings/:bookingId/orphaned-accept`
* **Reject Orphaned Booking**: `PATCH /api/bookings/:bookingId/orphaned-reject`

---

## 4. Cancellations

* **Request Cancellation**: `PATCH /api/bookings/:bookingId/request-cancel` (Guest only)
* **Approve Cancellation**: `PATCH /api/bookings/:bookingId/approve-cancel` (Host/Admin)

---

## 5. Journey Verification (OTP System)

To ensure safety and confirm that experiences are executed:

### 5.1 Send Start Journey OTP
* **Method**: `POST`
* **Path**: `/api/bookings/:bookingId/send-start-otp`
* **Auth**: Required (`checkAuth`)
* **Description**: Triggers an OTP sent to the guest to verify start of trip.

### 5.2 Verify Start Journey OTP
* **Method**: `POST`
* **Path**: `/api/bookings/:bookingId/verify-start-otp`
* **Auth**: Required (`checkAuth`)
* **Request Body**: `{ "otp": "1234" }`
* **Description**: Host inputs OTP provided by guest; transitions booking to `ongoing` / `in_progress`.

### 5.3 Send Completion OTP
* **Method**: `POST`
* **Path**: `/api/bookings/:bookingId/send-completion-otp`
* **Auth**: Required (`checkAuth`)
* **Description**: Triggers completion OTP to guest.

### 5.4 Verify Completion OTP
* **Method**: `POST`
* **Path**: `/api/bookings/:bookingId/verify-completion-otp`
* **Auth**: Required (`checkAuth`)
* **Request Body**: `{ "otp": "1234" }`
* **Description**: Transitions booking to `completed`.
