# Search & Geocoding API

Base prefix: `/api/search`

Full-text search across experiences, plans, treks, services, and users, along with autocomplete suggestions and geocoding proxies.

---

## 1. Search Endpoints

### 1.1 Universal Search
* **Method**: `GET`
* **Path**: `/api/search`
* **Auth**: Public
* **Query Parameters**:
  * `q`: `string` (Query term - searches title, description, address, categories, user bio/names)
  * `type`: `"all"` | `"experience"` | `"trek"` | `"service"` | `"people"` | `"host"` | `"guest"`
  * `location` or `city`: `string`
  * `difficulty`: `string`
  * `category`: `string`
  * `minPrice`, `maxPrice`: `number`
  * `sortBy`: `"createdAt"` | `"rating"` | `"price"`
  * `sortOrder`: `"desc"` | `"asc"`
  * `page`, `limit`: `number`
* **Success Response (200)**:
  ```json
  {
    "success": true,
    "message": "Search completed successfully",
    "data": {
      "results": [ ... ],
      "people": [ ... ],
      "experiences": [ ... ],
      "pagination": {
        "currentPage": 1,
        "totalPages": 4,
        "totalResults": 72,
        "resultsPerPage": 20
      },
      "filters": {
        "query": "rafting",
        "type": "all",
        "location": "Rishikesh"
      }
    }
  }
  ```

---

### 1.2 Advanced Search
* **Method**: `POST`
* **Path**: `/api/search/advanced`
* **Auth**: Public
* **Request Body** (`application/json`):
  ```json
  {
    "searchText": "hiking",
    "experienceTypes": ["experience", "trek"],
    "locations": ["Manali", "Kasol"],
    "difficulties": ["Moderate", "Challenging"],
    "categories": ["Trekking", "Adventure"],
    "priceRange": { "min": 1000, "max": 8000 },
    "durationRange": { "minDays": 2, "maxDays": 5 },
    "amenities": ["Guide", "Camp"],
    "rating": 4, // Minimum average rating
    "sortBy": "rating",
    "sortOrder": "desc",
    "page": 1,
    "limit": 20
  }
  ```
* **Success Response (200)**: Paginated search results matching all filter criteria.

---

### 1.3 Search Suggestions (Autocomplete)
* **Method**: `GET`
* **Path**: `/api/search/suggestions?q=kayak`
* **Auth**: Public
* **Success Response (200)**:
  ```json
  {
    "success": true,
    "data": {
      "suggestions": [
        {
          "text": "Kayaking in Backwaters",
          "location": "Alleppey",
          "type": "experience"
        }
      ]
    }
  }
  ```

---

### 1.4 Search by Location
* **Method**: `GET`
* **Path**: `/api/search/by-location`
* **Auth**: Public
* **Query Parameters**:
  * `location`: `string` (Required)
  * `type`: `"all"` | `"experience"` | `"trek"` | `"service"`
  * `sortBy`: `"createdAt"` | `"rating"` | `"price"`
  * `page`, `limit`: `number`
* **Success Response (200)**: Returns paginated list of matching experiences for the specified location.

---

## 2. Geocoding Proxies (Google Maps / OpenStreetMap Nominatim)

Proxies external geocoding requests to prevent CORS issues, inject authentication keys server-side, and fallback gracefully between Google Maps API and Nominatim.

### 2.1 Reverse Geocode (Coordinates to Address)
* **Method**: `GET`
* **Path**: `/api/search/geocode/reverse`
* **Auth**: Public
* **Query Parameters**:
  * `lat`: `number` (Required)
  * `lon`: `number` (Required)
* **Success Response (200)**:
  ```json
  {
    "place_id": "...",
    "lat": "12.9716",
    "lon": "77.5946",
    "display_name": "Bengaluru, Karnataka, India",
    "address": {
      "city": "Bengaluru",
      "state": "Karnataka",
      "country": "India",
      "country_code": "in",
      "postcode": "560001"
    }
  }
  ```

---

### 2.2 Geocode Search (Address to Coordinates)
* **Method**: `GET`
* **Path**: `/api/search/geocode/search`
* **Auth**: Public
* **Query Parameters**:
  * `q`: `string` (Required query address or city)
  * `viewbox`: optional bounding box (`min_lon,max_lat,max_lon,min_lat`)
* **Success Response (200)**: Array of matching location results with lat/lon and parsed address components.
