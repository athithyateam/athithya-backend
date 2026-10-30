# Experiences API

Base prefix: `/api/experiences`

The Experiences API manages all host experience listings, including outdoor activities, culinary workshops, cultural tours, and treks. Only verified hosts can create and manage experiences. Regular users (guests) can discover, search, bookmark, and review experiences.

---

## 1. Media Upload Pre-requisite

### 1.1 Generate S3 Pre-signed URL
Before creating or updating an experience, media assets (photos and videos) must be uploaded directly to AWS S3 using a pre-signed URL.
* **Method**: `GET`
* **Path**: `/api/experiences/presigned-url`
* **Auth**: Required (`checkAuth`)
* **Query Parameters**:
  * `fileName`: `string` (e.g. `kayaking_sunset.jpg`)
  * `fileType`: `string` (e.g. `image/jpeg` or `video/mp4`)
  * `folder`: `string` (Optional, defaults to `"experiences"`)
* **Success Response (200)**:
  ```json
  {
    "success": true,
    "uploadUrl": "https://athithya-bucket.s3.amazonaws.com/experiences/xyz?AWSAccessKeyId=...",
    "fileUrl": "https://athithya-bucket.s3.amazonaws.com/experiences/xyz.jpg",
    "public_id": "experiences/xyz"
  }
  ```
* **Client Flow**: 
  1. Client calls `GET /api/experiences/presigned-url`.
  2. Client uploads file binary directly via HTTP `PUT` to `uploadUrl` with matching `Content-Type`.
  3. Client includes `{ "url": fileUrl, "public_id": public_id }` in the photos or videos array when submitting the experience.

---

## 2. Core Experience Operations

### 2.1 Create Experience
* **Method**: `POST`
* **Path**: `/api/experiences`
* **Auth**: Required (`checkAuth`, `checkApprovedHost` — only verified hosts can list experiences)
* **Request Body** (`application/json`):
  ```json
  {
    "title": "Sunset Kayaking at Backwaters",
    "subtitle": "Serene 2-hour guided paddling through serene lagoons",
    "description": "Short summary of the experience",
    "longDescription": "Detailed breakdown of the itinerary, safety briefings, and gear...",
    "location": {
      "city": "Alleppey",
      "state": "Kerala",
      "country": "India",
      "meetingPoint": "Finishing Point Jetty, Boat House Dock",
      "coordinates": {
        "type": "Point",
        "coordinates": [76.3388, 9.4981]
      }
    },
    "price": {
      "perPerson": 1200,
      "total": 1200,
      "period": "person"
    },
    "capacity": {
      "maxPeople": 8
    },
    "duration": {
      "hours": 2,
      "minutes": 30,
      "days": 0
    },
    "categories": ["Kayaking", "Water Sports", "Adventure"],
    "tags": ["Backwaters", "Sunset", "Paddling"],
    "amenities": ["Life Jackets", "Guide", "Water Bottle", "Dry Bag"],
    "photos": [
      {
        "url": "https://athithya-bucket.s3.amazonaws.com/experiences/photo1.jpg",
        "public_id": "experiences/photo1"
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
    "message": "Experience created successfully",
    "experience": {
      "_id": "6722a1b9...",
      "title": "Sunset Kayaking at Backwaters",
      "user": "60d0aa...",
      "status": "pending",
      "rating": {
        "average": 0,
        "count": 0
      },
      "createdAt": "2026-10-30T10:00:00.000Z"
    }
  }
  ```

---

### 2.2 Get Experiences (Filtered & Paginated List)
* **Method**: `GET`
* **Path**: `/api/experiences`
* **Auth**: Public
* **Query Parameters**:
  * `page`: `number` (default: 1)
  * `limit`: `number` (default: 20)
  * `city`: `string`
  * `state`: `string`
  * `country`: `string`
  * `categories` or `category`: `string` (e.g. `Kayaking` or `Trek`)
  * `difficulty`: `"Easy"` | `"Moderate"` | `"Challenging"` | `"Difficult"`
  * `minPrice`: `number`
  * `maxPrice`: `number`
  * `sort`: `"clicks"` | `"bookings"` | `"recent"` | `"rating"` | `"price_low"` | `"price_high"`
* **Success Response (200)**:
  ```json
  {
    "success": true,
    "count": 12,
    "total": 45,
    "page": 1,
    "totalPages": 4,
    "experiences": [ ... ]
  }
  ```

---

### 2.3 Get Experience Detail
* **Method**: `GET`
* **Path**: `/api/experiences/:id`
* **Auth**: Public
* **Success Response (200)**:
  Returns full populated experience document with host details (`firstname`, `lastname`, `avatar`, `role`, `bio`), rating breakdown, and similar experiences.

---

### 2.4 Update Experience
* **Method**: `PUT`
* **Path**: `/api/experiences/:id`
* **Auth**: Required (`checkAuth` — author or admin)
* **Request Body** (`application/json`): Experience fields to update.
* **Success Response (200)**:
  ```json
  {
    "success": true,
    "message": "Experience updated successfully",
    "experience": { ... }
  }
  ```

---

### 2.5 Request to Hide Experience
* **Method**: `PATCH`
* **Path**: `/api/experiences/:id/request-hide`
* **Auth**: Required (`checkAuth` — author only)
* **Success Response (200)**:
  ```json
  {
    "success": true,
    "message": "Experience visibility updated",
    "isHidden": true
  }
  ```

---

### 2.6 Delete Experience
* **Method**: `DELETE`
* **Path**: `/api/experiences/:id`
* **Auth**: Required (`checkAuth` — author or admin)
* **Success Response (200)**:
  ```json
  {
    "success": true,
    "message": "Experience deleted successfully"
  }
  ```

---

## 3. Bookmarking & Wishlist Endpoints

### 3.1 Save Experience (Bookmark)
* **Method**: `POST`
* **Path**: `/api/experiences/:id/save`
* **Auth**: Required (`checkAuth`)
* **Restriction**: Hosts are not allowed to bookmark experiences; only guests can.
* **Success Response (200)**:
  ```json
  {
    "success": true,
    "message": "Experience saved to wishlist",
    "isSaved": true
  }
  ```

---

### 3.2 Unsave Experience (Remove Bookmark)
* **Method**: `DELETE`
* **Path**: `/api/experiences/:id/save`
* **Auth**: Required (`checkAuth`)
* **Success Response (200)**:
  ```json
  {
    "success": true,
    "message": "Experience removed from wishlist",
    "isSaved": false
  }
  ```

---

## 4. Experience Reviews

### 4.1 Get Reviews for Experience
* **Method**: `GET`
* **Path**: `/api/experiences/reviews/:experienceId`
* **Auth**: Public
* **Success Response (200)**:
  ```json
  {
    "success": true,
    "count": 5,
    "reviews": [ ... ]
  }
  ```

---

## 5. User & Host Specific Lists

### 5.1 Get Experiences by User / Host
* **Method**: `GET`
* **Path**: `/api/experiences/user/:userId`
* **Auth**: Public

### 5.2 Get My Experiences (Logged-in Host)
* **Method**: `GET`
* **Path**: `/api/experiences/my/experiences`
* **Auth**: Required (`checkAuth`)

---

## 6. Curated & Category Discovery Feeds

* **Top-Rated Treks**: `GET /api/experiences/top-rated/treks` (Public)
* **Nearby Treks**: `GET /api/experiences/nearby/treks` (Public — uses GeoJSON coordinates)
* **Treks Listing**: `GET /api/experiences/treks` (Public — filters `categories: Trek`)
* **Featured Experiences**: `GET /api/experiences/featured/list` (Public — sorted by popularity)
* **Latest Experiences**: `GET /api/experiences/latest` (Public — sorted by creation date)
* **Most Loved**: `GET /api/experiences/most-loved` (Public — sorted by bookings)
* **Category Activity**: `GET /api/experiences/categories/activity` (Public — recent activity and highlight tags per category)

---

## 7. Admin Moderation Endpoints

* **Get Pending Experiences**: `GET /api/experiences/admin/pending` (Requires `checkAuth`, `checkAdmin`)
* **Update Experience Status**: `PATCH /api/experiences/admin/:id/status` (Requires `checkAuth`, `checkAdmin`)
  * **Request Body**: `{ "status": "active" | "rejected", "adminComment": "..." }`
