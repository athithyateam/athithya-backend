# Reviews & Ratings API

Base prefix: `/api/reviews`

Handles guest reviews for hosts and experiences, verified completion requirements, rating statistics, and eligibility checks.

---

## 1. Review Submission & Editing

### 1.1 Create or Submit Review
* **Method**: `POST`
* **Path**: `/api/reviews`
* **Auth**: Required (`checkAuth`)
* **Eligibility Rules**:
  * Hosts cannot review other hosts.
  * Users cannot review themselves.
  * If `experienceId` is provided, guest must have a `completed` booking for that specific experience.
* **Request Body** (`application/json`):
  ```json
  {
    "hostId": "60d0aa...",
    "experienceId": "64f1a2b...", // Optional: specific experience review
    "rating": 5, // Number between 1 and 5
    "comment": "Had an incredible time! The host was super knowledgeable."
  }
  ```
* **Success Response (201 / 200)**:
  ```json
  {
    "success": true,
    "message": "Rating submitted successfully",
    "review": {
      "_id": "650c...",
      "reviewer": { ... },
      "host": { ... },
      "experience": { ... },
      "rating": 5,
      "comment": "..."
    }
  }
  ```

---

### 1.2 Update Review
* **Method**: `PUT`
* **Path**: `/api/reviews/:id`
* **Auth**: Required (`checkAuth` - author only)
* **Request Body** (`application/json`):
  ```json
  {
    "rating": 4,
    "comment": "Updated thoughts..."
  }
  ```
* **Success Response (200)**: Returns updated review and automatically re-calculates experience and host average ratings.

---

### 1.3 Delete Review
* **Method**: `DELETE`
* **Path**: `/api/reviews/:id`
* **Auth**: Required (`checkAuth` - review author or `admin`)
* **Success Response (200)**: Removes review and automatically recalculates experience and host ratings.

---

## 2. Review Retrieval & Eligibility

### 2.1 Check Review Eligibility
* **Method**: `GET`
* **Path**: `/api/reviews/check-eligibility?experienceId=64f1a2b...`
* **Auth**: Required (`checkAuth`)
* **Success Response (200)**:
  ```json
  {
    "success": true,
    "eligible": true,
    "canReview": true,
    "hasReviewed": false,
    "existingReview": null
  }
  ```
* **Failure Responses (200 with `eligible: false`)**:
  * Reason: `"host_restricted"` (User is a host)
  * Reason: `"not_booked"` (Guest never booked this experience or host)
  * Reason: `"not_completed"` (Booking is pending or ongoing, not completed)

---

### 2.2 Get Host Reviews (Public)
* **Method**: `GET`
* **Path**: `/api/reviews/host/:hostId`
* **Auth**: Public
* **Query Parameters**:
  * `page`: `number` (default: 1)
  * `limit`: `number` (default: 20, max: 100)
  * `rating`: `number` (Filter by specific star rating: 1-5)
  * `includeRatingOnly`: `"true"` | `"false"`
* **Success Response (200)**:
  ```json
  {
    "success": true,
    "count": 10,
    "total": 25,
    "averageRating": 4.85,
    "totalRatings": 25,
    "totalReviews": 18,
    "ratingDistribution": {
      "5": 20,
      "4": 4,
      "3": 1,
      "2": 0,
      "1": 0
    },
    "reviews": [ ... ]
  }
  ```

---

### 2.3 Get Latest Written Reviews (Homepage Feed)
* **Method**: `GET`
* **Path**: `/api/reviews/latest?limit=20`
* **Auth**: Public
* **Success Response (200)**: Newest written reviews with reviewer and host details for homepage guest testimonial carousel.

---

### 2.4 User-Centric Reviews
* **Get My Written Reviews**: `GET /api/reviews/my/reviews` (Auth required)
* **Get Reviews Received (Hosts)**: `GET /api/reviews/received` (Auth required - Host only)
* **Get Reviews Written by User**: `GET /api/reviews/reviewer/:reviewerId` (Public)
* **Get Single Review by ID**: `GET /api/reviews/:id` (Public)
