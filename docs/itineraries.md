# Itineraries (Plans) API

Base prefix: `/api/itineraries`

Manages curated travel plans, multi-day itineraries, explore feeds, and location aggregation.

---

## 1. Itinerary Management

### 1.1 Create Itinerary (Plan)
* **Method**: `POST`
* **Path**: `/api/itineraries`
* **Auth**: Required (`checkAuth`)
* **Request Body** (`application/json`):
  ```json
  {
    "title": "3 Days in Munnar: Tea Gardens & Peaks",
    "subtitle": "A tranquil escape through foggy hills",
    "description": "Complete breakdown of a weekend getaway...",
    "planName": "Munnar Explorer",
    "location": {
      "city": "Munnar",
      "state": "Kerala",
      "country": "India"
    },
    "priceTotal": 6500,
    "pricePerPerson": 3250,
    "maxPeople": 4,
    "duration": {
      "days": 3,
      "nights": 2
    },
    "difficulty": "Easy",
    "categories": ["Nature", "Hill Station"],
    "tags": ["Tea Plantation", "Trekking"],
    "amenities": ["Transport", "Campfire"],
    "photos": [
      { "url": "https://athithya-bucket.s3.amazonaws.com/posts/munnar1.jpg", "public_id": "posts/munnar1" }
    ],
    "videos": []
  }
  ```
* **Success Response (201)**: Returns created itinerary document (`postType: "plan"`).

---

### 1.2 Get All Itineraries (Filtered)
* **Method**: `GET`
* **Path**: `/api/itineraries`
* **Auth**: Public
* **Query Parameters**:
  * `city`, `state`, `country`: `string`
  * `minPrice`, `maxPrice`: `number`
  * `tags`: comma-separated string
  * `categories`: comma-separated string
  * `difficulty`: `string`
  * `page`, `limit`: `number`
* **Success Response (200)**: Paginated array of itineraries.

---

### 1.3 Update Itinerary
* **Method**: `PUT`
* **Path**: `/api/itineraries/:id`
* **Auth**: Required (`checkAuth` - author only)
* **Request Body** (`application/json`): Fields to update, including merged `photos` and `existingPhotos` strings for S3 delta cleaning.

---

### 1.4 Delete Itinerary
* **Method**: `DELETE`
* **Path**: `/api/itineraries/:id`
* **Auth**: Required (`checkAuth` - author or admin)
* **Success Response (200)**: Deletes or sets `deleteRequested: true` if non-admin.

---

## 2. Explore & Location Aggregation

### 2.1 Complete Itineraries for Explore Page
* **Method**: `GET`
* **Path**: `/api/itineraries/explore/complete`
* **Auth**: Public
* **Query Parameters**:
  * `city`, `state`, `country`: `string`
  * `minPrice`, `maxPrice`: `number`
  * `sortBy`: `"recent"` | `"popular"` | `"rating"` | `"price_low"` | `"price_high"`
  * `page`, `limit`: `number`
* **Success Response (200)**:
  ```json
  {
    "success": true,
    "count": 10,
    "total": 32,
    "page": 1,
    "stats": {
      "avgPrice": 4200,
      "minPrice": 1500,
      "maxPrice": 12000,
      "totalPlans": 32
    },
    "topLocations": [
      { "city": "Munnar", "state": "Kerala", "country": "India", "count": 12 }
    ],
    "itineraries": [ ... ]
  }
  ```

---

### 2.2 Combined Location Data (Itineraries + Experiences)
* **Method**: `GET`
* **Path**: `/api/itineraries/location/combined`
* **Auth**: Public
* **Query Parameters**:
  * `city`, `state`, or `country`: (At least one required)
  * `page`, `limit`: `number`
* **Success Response (200)**:
  ```json
  {
    "success": true,
    "location": { "city": "Goa", "state": "Goa", "country": "India" },
    "plans": { "data": [ ... ], "total": 5 },
    "experiences": { "data": [ ... ], "total": 14 }
  }
  ```

---

## 3. Social Interactions

* **Get Single Itinerary**: `GET /api/itineraries/:id` (Public)
* **Get User Itineraries**: `GET /api/itineraries/user/:userId` (Public)
* **Get My Itineraries**: `GET /api/itineraries/my/itineraries` (Auth required)
* **Save Itinerary**: `POST /api/itineraries/:id/save` (Auth required)
* **Unsave Itinerary**: `DELETE /api/itineraries/:id/save` (Auth required)
* **React to Itinerary**: `PUT /api/itineraries/:id/react` (Auth required, Body: `{ "emoji": "🔥" }`)
* **Get Reaction Stats**: `GET /api/itineraries/:id/reactions` (Public)
