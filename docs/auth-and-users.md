# Authentication & Users API

Base prefixes:
* `/api/auth`
* `/api/users`

---

## 1. Authentication Endpoints

### 1.1 Initiate Signup
* **Method**: `POST`
* **Path**: `/api/auth/signup/initiate` or `/api/users/signup/initiate`
* **Auth**: Public
* **Rate Limit**: OTP Request Limiter
* **Request Body** (`application/json`):
  ```json
  {
    "firstname": "John",
    "lastname": "Doe",
    "email": "john@example.com",
    "password": "secretpassword",
    "role": "guest" // Optional: "guest" or "host" (default: "guest")
  }
  ```
* **Success Response (200)**:
  ```json
  {
    "success": true,
    "message": "OTP sent to your email. Please verify to complete registration."
  }
  ```

---

### 1.2 Complete Signup (Verify OTP)
* **Method**: `POST`
* **Path**: `/api/auth/signup/complete` or `/api/users/signup/complete`
* **Auth**: Public
* **Rate Limit**: OTP Verify Limiter
* **Request Body** (`application/json`):
  ```json
  {
    "firstname": "John",
    "lastname": "Doe",
    "email": "john@example.com",
    "password": "secretpassword",
    "role": "guest",
    "otp": "123456"
  }
  ```
* **Success Response (201)**:
  ```json
  {
    "success": true,
    "message": "User registered successfully",
    "token": "eyJhbGciOi...",
    "user": {
      "_id": "60d0fe4f5311236168a109ca",
      "firstname": "John",
      "lastname": "Doe",
      "email": "john@example.com",
      "role": "guest"
    }
  }
  ```

---

### 1.3 Sign In
* **Method**: `POST`
* **Path**: `/api/auth/signin` or `/api/users/signin`
* **Auth**: Public
* **Rate Limit**: Signin Limiter
* **Request Body** (`application/json`):
  ```json
  {
    "email": "john@example.com",
    "password": "secretpassword"
  }
  ```
* **Success Response (200)**:
  ```json
  {
    "success": true,
    "message": "Signed in successfully",
    "token": "eyJhbGciOi...",
    "user": {
      "_id": "60d0fe4f5311236168a109ca",
      "firstname": "John",
      "lastname": "Doe",
      "email": "john@example.com",
      "role": "guest",
      "avatar": { "url": "..." }
    }
  }
  ```

---

### 1.4 Google Sign In
* **Method**: `POST`
* **Path**: `/api/auth/google` or `/api/users/google`
* **Auth**: Public
* **Request Body** (`application/json`):
  ```json
  {
    "token": "<GOOGLE_OAUTH_ID_TOKEN>",
    "role": "guest" // Optional: "guest" or "host"
  }
  ```
* **Success Response (200)**:
  ```json
  {
    "success": true,
    "token": "eyJhbGciOi...",
    "user": { ... }
  }
  ```

---

### 1.5 Forgot Password
* **Method**: `POST`
* **Path**: `/api/auth/forgot-password` or `/api/users/forgot-password`
* **Auth**: Public
* **Request Body** (`application/json`):
  ```json
  {
    "email": "john@example.com"
  }
  ```
* **Success Response (200)**:
  ```json
  {
    "success": true,
    "message": "Password reset OTP sent to email"
  }
  ```

---

### 1.6 Reset Password
* **Method**: `POST`
* **Path**: `/api/auth/reset-password` or `/api/users/reset-password`
* **Auth**: Public
* **Request Body** (`application/json`):
  ```json
  {
    "email": "john@example.com",
    "otp": "123456",
    "newPassword": "newsecretpassword"
  }
  ```
* **Success Response (200)**:
  ```json
  {
    "success": true,
    "message": "Password updated successfully"
  }
  ```

---

### 1.7 Logout
* **Method**: `POST`
* **Path**: `/api/auth/logout` or `/api/users/logout`
* **Auth**: Public
* **Success Response (200)**: Clears authentication cookie.

---

### 1.8 Get Current User (Me)
* **Method**: `GET`
* **Path**: `/api/auth/me` or `/api/users/me`
* **Auth**: Required (`checkAuth`)
* **Success Response (200)**:
  ```json
  {
    "success": true,
    "user": {
      "_id": "60d0fe4f5311236168a109ca",
      "firstname": "John",
      "lastname": "Doe",
      "email": "john@example.com",
      "role": "guest",
      "avatar": { "url": "..." },
      "location": { ... }
    }
  }
  ```

---

## 2. Profile Management

### 2.1 Update Profile
* **Method**: `PUT`
* **Path**: `/api/users/profile`
* **Auth**: Required (`checkAuth`)
* **Request Body** (`application/json`):
  ```json
  {
    "firstname": "John",
    "lastname": "Doe",
    "bio": "Traveler and hiker",
    "description": "More detailed description",
    "phone": "+919876543210",
    "avatarUrl": "https://s3.amazonaws.com/.../avatar.jpg",
    "avatarPublicId": "avatars/xyz"
  }
  ```
* **Success Response (200)**: Returns updated user profile.

---

### 2.2 Update User Location
* **Method**: `PUT`
* **Path**: `/api/users/location`
* **Auth**: Required (`checkAuth`)
* **Request Body** (`application/json`):
  ```json
  {
    "city": "Bengaluru",
    "state": "Karnataka",
    "country": "India",
    "coordinates": [77.5946, 12.9716]
  }
  ```
* **Success Response (200)**:
  ```json
  {
    "success": true,
    "location": { ... }
  }
  ```

---

### 2.3 Get User Location
* **Method**: `GET`
* **Path**: `/api/users/location`
* **Auth**: Required (`checkAuth`)
* **Success Response (200)**: Returns user's saved location.

---

### 2.4 Get My Saved Experiences (Wishlist)
* **Method**: `GET`
* **Path**: `/api/users/me/saved`
* **Auth**: Required (`checkAuth`)
* **Success Response (200)**:
  ```json
  {
    "success": true,
    "experiences": [ ... ]
  }
  ```

---

### 2.5 Delete My Account
* **Method**: `DELETE`
* **Path**: `/api/users/profile`
* **Auth**: Required (`checkAuth`)
* **Success Response (200)**:
  ```json
  {
    "success": true,
    "message": "Account successfully deleted"
  }
  ```

---

### 2.6 Phone OTP Verification
* **Send Phone OTP**: `POST /api/users/verify-phone/send-otp` (Requires `checkAuth`, Body: `{ "phone": "+91..." }`)
* **Verify Phone OTP**: `POST /api/users/verify-phone/verify-otp` (Requires `checkAuth`, Body: `{ "phone": "+91...", "otp": "1234" }`)

---

### 2.7 Submit Host Verification
* **Method**: `POST`
* **Path**: `/api/users/verify-host`
* **Auth**: Required (`checkAuth`)
* **Request Body** (`application/json`):
  ```json
  {
    "idProofType": "Aadhar",
    "idProofNumber": "XXXX-XXXX-XXXX",
    "idProofDocument": "s3_url",
    "experienceDescription": "...",
    "address": "..."
  }
  ```
* **Success Response (200)**:
  ```json
  {
    "success": true,
    "message": "Host verification application submitted for admin review"
  }
  ```

---

## 3. Public User & Host Profiles

### 3.1 Get Public Profile
* **Method**: `GET`
* **Path**: `/api/users/profile/:userId`
* **Auth**: Optional (`checkOptionalAuth`)
* **Success Response (200)**: Returns public sanitized profile (bio, avatar, role, name).

---

### 3.2 Get Complete Profile
* **Method**: `GET`
* **Path**: `/api/users/profile/:userId/complete`
* **Auth**: Optional (`checkOptionalAuth`)
* **Success Response (200)**: Returns complete profile including experiences, reviews count, and social links.

---

### 3.3 Get Top Rated Hosts
* **Method**: `GET`
* **Path**: `/api/users/top-rated/hosts`
* **Auth**: Public
* **Success Response (200)**: Array of top-rated host profiles with rating averages and review counts.

---

### 3.4 Get Guests Directory
* **Method**: `GET`
* **Path**: `/api/users/guests`
* **Auth**: Optional (`checkOptionalAuth`)
* **Success Response (200)**: List of guests with pagination.

---

## 4. Host Grid Media & Gallery

* **Get Host Grid Media**: `GET /api/users/profile/:userId/grid-media` (Optional auth)
* **Update Tab Preference**: `PATCH /api/users/grid-tab-preference` (Auth required, Body: `{ "tab": "personal" | "experiences" }`)
* **Add Personal Media**: `POST /api/users/personal-media` (Auth required, Body: `{ "url": "...", "publicId": "...", "caption": "..." }`)
* **Delete Personal Media**: `DELETE /api/users/personal-media/:id` (Auth required)
* **Toggle Pin Personal Media**: `PATCH /api/users/personal-media/:id/pin` (Auth required)
* **Toggle Pin Experience Media**: `PATCH /api/users/experience-media/pin` (Auth required, Body: `{ "mediaKey": "...", "experienceId": "..." }`)

---

## 5. Friendships & Social

* **Send Friend Request**: `POST /api/users/:id/friend-request` (Auth required)
* **Accept Friend Request**: `POST /api/users/:id/friend-accept` (Auth required)
* **Reject Friend Request**: `POST /api/users/:id/friend-reject` (Auth required)
* **Unfriend**: `POST /api/users/:id/unfriend` (Auth required)
* **Get Friends**: `GET /api/users/:id/friends` (Auth required)

---

## 6. Get User by ID (Catch-all)
* **Method**: `GET`
* **Path**: `/api/users/:id`
* **Auth**: Required (`checkAuth`)
* **Success Response (200)**: User details.
