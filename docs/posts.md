# Posts API (Experiences, Services, Treks)

Base prefix: `/api/posts`

Posts represent Experiences, Plans/Itineraries, Services, and Treks in the system.

---

## 1. Media Upload Pre-requisite

### 1.1 Generate S3 Pre-signed URL
* **Method**: `GET`
* **Path**: `/api/posts/presigned-url`
* **Auth**: Required (`checkAuth`)
* **Query Parameters**:
  * `fileName`: `string` (e.g. `trek1.jpg`)
  * `fileType`: `string` (e.g. `image/jpeg` or `video/mp4`)
  * `folder`: `string` (Optional, defaults to `"posts"`)
* **Success Response (200)**:
  ```json
  {
    "success": true,
    "uploadUrl": "https://athithya-bucket.s3.amazonaws.com/posts/xyz?AWSAccessKeyId=...",
    "fileUrl": "https://athithya-bucket.s3.amazonaws.com/posts/xyz.jpg",
    "public_id": "posts/xyz"
  }
  ```
* **Frontend Flow**: Client requests presigned URL, performs `PUT` directly to `uploadUrl`, then submits `fileUrl` and `public_id` in the post creation/update payload.

---

## 2. General Post Operations

### 2.1 Create Post
* **Method**: `POST`
* **Path**: `/api/posts`
* **Auth**: Required (`checkAuth`, `checkApprovedHost`)
* **Request Body** (`application/json`):
  ```json
  {
    "postType": "experience", // "experience" | "service" | "trek" | "plan"
    "title": "Sunset Kayaking at Backwaters",
    "subtitle": "Serene 2-hour guided paddling",
    "description": "Short summary",
    "longDescription": "Detailed itinerary description...",
    "location": {
      "city": "Alleppey",
      "state": "Kerala",
      "country": "India",
      "meetingPoint": "Finishing Point Jetty",
      "coordinates": {
        "type": "Point",
        "coordinates": [76.3388, 9.4981]
      }
    },
    "price": {
      "perPerson": 1200,
      "total": 1200,
      "period": "per person"
    },
    "capacity": {
      "maxPeople": 8
    },
    "duration": {
      "hours": 2,
      "minutes": 30
    },
    "categories": ["Kayaking", "Water Sports"],
    "amenities": ["Life Jackets", "Guide", "Water Bottle"],
    "photos": [
      {
        "url": "https://athithya-bucket.s3.amazonaws.com/posts/photo1.jpg",
        "public_id": "posts/photo1"
      }
    ],
    "videos": [],
    "difficulty": "Easy",
    "isFeatured": false
  }
  ```
* **Success Response (201)**:
  ```json
  {
    "success": true,
    "message": "Post created successfully",
    "post": {
      "_id": "64f1a2b...",
      "status": "pending", // Newly created experiences await admin review
      ...
    }
  }
  ```

---

### 2.2 Get Posts (Filtered List)
* **Method**: `GET`
* **Path**: `/api/posts`
* **Auth**: Public
* **Query Parameters**:
  * `page`: `number` (default: 1)
  * `limit`: `number` (default: 20)
  * `city`: `string`
  * `state`: `string`
  * `country`: `string`
  * `category`: `string`
  * `difficulty`: `string`
  * `minPrice`: `number`
  * `maxPrice`: `number`
  * `postType`: `string` or array of types
  * `sort`: `"clicks"` | `"bookings"` | `"recent"` | `"rating"` | `"price_low"` | `"price_high"`
* **Success Response (200)**:
  ```json
  {
    "success": true,
    "count": 15,
    "total": 45,
    "page": 1,
    "totalPages": 3,
    "posts": [ ... ]
  }
  ```

---

### 2.3 Get Post Detail
* **Method**: `GET`
* **Path**: `/api/posts/:id`
* **Auth**: Public
* **Success Response (200)**: Complete populated post document with host details and rating breakdown.

---

### 2.4 Update Post
* **Method**: `PUT`
* **Path**: `/api/posts/:id`
* **Auth**: Required (`checkAuth` - must be author/owner)
* **Request Body** (`application/json`): Fields to update.
* **Success Response (200)**: Updated post document.

---

### 2.5 Request to Hide Post
* **Method**: `PATCH`
* **Path**: `/api/posts/:id/request-hide`
* **Auth**: Required (`checkAuth` - author)
* **Success Response (200)**: Flags post visibility status.

---

### 2.6 Delete Post
* **Method**: `DELETE`
* **Path**: `/api/posts/:id`
* **Auth**: Required (`checkAuth` - owner or admin)
* **Success Response (200)**: Deletion confirmation or review flag if non-admin.

---

## 3. Social & Interaction Endpoints

### 3.1 React to Post
* **Method**: `PUT`
* **Path**: `/api/posts/:id/react` (alias: `/api/posts/:postId/react`)
* **Auth**: Required (`checkAuth`)
* **Request Body**:
  ```json
  {
    "emoji": "❤️"
  }
  ```
* **Success Response (200)**: Returns user action (`"added"`, `"updated"`, `"removed"`), reaction statistics, and total counts.

---

### 3.2 Save / Bookmark Post
* **Method**: `POST`
* **Path**: `/api/posts/:id/save`
* **Auth**: Required (`checkAuth`)
* **Note**: Hosts are restricted from bookmarking other experiences.
* **Success Response (200)**: Adds post ID to `user.savedPosts` and increments `savesCount`.

---

### 3.3 Unsave / Remove Bookmark
* **Method**: `DELETE`
* **Path**: `/api/posts/:id/save`
* **Auth**: Required (`checkAuth`)
* **Success Response (200)**: Removes post ID from wishlist.

---

### 3.4 Get Post Reviews
* **Method**: `GET`
* **Path**: `/api/posts/reviews/:postId`
* **Auth**: Public
* **Success Response (200)**: Array of reviews associated with this post.

---

### 3.5 Get User's Posts
* **Method**: `GET`
* **Path**: `/api/posts/user/:userId` (or `/api/posts/my/posts` for authenticated user)
* **Success Response (200)**: Posts authored by specified user.

---

## 4. Specialized Categorical Endpoints

* **Category Activity**: `GET /api/posts/categories/activity` (Public)
* **Top-Rated Treks**: `GET /api/posts/top-rated/treks` (Public)
* **Nearby Treks**: `GET /api/posts/nearby/treks` (Public)
* **Experiences List**: `GET /api/posts/experiences` (Public)
* **Most Booked Experiences**: `GET /api/posts/most-reacted/experiences` (Public, sorted by bookings)
* **Featured Experiences**: `GET /api/posts/experiences/featured/list` (Public)
* **Services List**: `GET /api/posts/services` (Public)
* **Treks List**: `GET /api/posts/treks` (Public)
