/**
 * Geocoding Service
 * Platform geospatial infrastructure service integrating Google Maps Geocoding API
 * with OpenStreetMap Nominatim fallback for forward and reverse geocoding.
 */

import axios from "axios";

export interface ParsedAddress {
    state?: string;
    county?: string;
    district?: string;
    city?: string;
    town?: string;
    village?: string;
    country?: string;
    country_code?: string;
    postcode?: string;
    [key: string]: string | undefined;
}

export interface GeocodePlaceResult {
    place_id: string | number;
    lat: string;
    lon: string;
    display_name: string;
    name?: string;
    address: ParsedAddress;
}

export interface GeocodeSearchOptions {
    viewbox?: string;
    [key: string]: any;
}

export class GeocodingService {
    private static instance: GeocodingService | null = null;
    private static instanceKey = Symbol("GeocodingServiceInstanceKey");

    private apiKey: string | undefined;
    private httpClient: typeof axios;

    constructor(
        instanceKey: symbol,
        apiKey: string | undefined = process.env.GOOGLE_MAPS_API_KEY,
        httpClient: typeof axios = axios
    ) {
        if (instanceKey !== GeocodingService.instanceKey) {
            throw new Error("Use GeocodingService.getInstance() to retrieve the singleton instance");
        }
        this.apiKey = apiKey;
        this.httpClient = httpClient;
    }

    public static getInstance(apiKey?: string, httpClient?: typeof axios): GeocodingService {
        if (!this.instance) {
            this.instance = new GeocodingService(
                this.instanceKey,
                apiKey !== undefined ? apiKey : process.env.GOOGLE_MAPS_API_KEY,
                httpClient || axios
            );
        }
        return this.instance;
    }

    /**
     * Parse Google address_components into normalized address structure
     */
    public parseGoogleAddress(addressComponents: any[] = []): ParsedAddress {
        if (!Array.isArray(addressComponents)) return {};

        const getComponent = (types: string[]): string => {
            const comp = addressComponents.find((c: any) =>
                types.some((t: string) => c.types && c.types.includes(t))
            );
            return comp ? comp.long_name : "";
        };

        const countryCodeComp = addressComponents.find((c: any) =>
            c.types && c.types.includes("country")
        );
        const country_code = countryCodeComp ? countryCodeComp.short_name.toLowerCase() : "";

        const state = getComponent(["administrative_area_level_1"]);
        const county = getComponent(["administrative_area_level_2"]);
        const city = getComponent(["locality"]) || getComponent(["postal_town"]);
        const town = getComponent(["sublocality_level_1"]) || getComponent(["neighborhood"]);
        const village = getComponent(["sublocality_level_2"]) || getComponent(["sublocality_level_3"]);
        const country = getComponent(["country"]);
        const postcode = getComponent(["postal_code"]);

        const rawAddr: Record<string, string> = {
            state,
            county,
            district: county,
            city: city || town || village,
            town: town || city || village,
            village: village || town || city,
            country,
            country_code,
            postcode
        };

        const cleaned: ParsedAddress = {};
        for (const [key, val] of Object.entries(rawAddr)) {
            if (val && val.trim() !== "") {
                cleaned[key] = val.trim();
            }
        }
        return cleaned;
    }

    /**
     * Map Google geocoding item into standardized Place result
     */
    public formatGooglePlace(result: any, defaultName?: string): GeocodePlaceResult {
        const address = this.parseGoogleAddress(result.address_components || []);
        const firstComp = result.address_components && result.address_components[0];
        const name = firstComp ? firstComp.long_name : (defaultName || result.formatted_address || "");

        return {
            place_id: result.place_id,
            lat: result.geometry?.location?.lat?.toString() || "",
            lon: result.geometry?.location?.lng?.toString() || "",
            display_name: result.formatted_address || "",
            name,
            address
        };
    }

    /**
     * Reverse geocode coordinates to structured address
     */
    public async reverseGeocode(lat: string | number, lon: string | number): Promise<any> {
        if (lat === undefined || lon === undefined || lat === "" || lon === "") {
            const err: any = new Error("Latitude and longitude are required");
            err.statusCode = 400;
            throw err;
        }

        const apiKey = this.apiKey || process.env.GOOGLE_MAPS_API_KEY;
        if (apiKey) {
            try {
                const response = await this.httpClient.get(
                    "https://maps.googleapis.com/maps/api/geocode/json",
                    { params: { latlng: `${lat},${lon}`, key: apiKey } }
                );
                if (response.data?.status === "OK" && response.data.results?.length > 0) {
                    return this.formatGooglePlace(response.data.results[0]);
                }
            } catch (err: any) {
                console.error("Google reverse geocode error, falling back to Nominatim:", err.message);
            }
        }

        const response = await this.httpClient.get("https://nominatim.openstreetmap.org/reverse", {
            params: { format: "json", lat, lon },
            headers: { "User-Agent": "AthithyaApp/1.0 (athithya.in)" }
        });
        return response.data;
    }

    /**
     * Forward geocode query text to place results
     */
    public async geocodeSearch(query: string, options: GeocodeSearchOptions = {}): Promise<any> {
        if (!query || !query.trim()) {
            const err: any = new Error("Query parameter 'q' is required");
            err.statusCode = 400;
            throw err;
        }

        const apiKey = this.apiKey || process.env.GOOGLE_MAPS_API_KEY;
        if (apiKey) {
            try {
                const params: Record<string, any> = {
                    address: query.trim(),
                    key: apiKey,
                    components: "country:IN"
                };

                if (options.viewbox) {
                    const [min_lon, max_lat, max_lon, min_lat] = options.viewbox.split(",").map(Number);
                    if (!isNaN(min_lon) && !isNaN(max_lat) && !isNaN(max_lon) && !isNaN(min_lat)) {
                        params.bounds = `${min_lat},${min_lon}|${max_lat},${max_lon}`;
                    }
                }

                const response = await this.httpClient.get(
                    "https://maps.googleapis.com/maps/api/geocode/json",
                    { params }
                );
                if (response.data?.status === "OK" && response.data.results?.length > 0) {
                    return response.data.results.map((r: any) => this.formatGooglePlace(r, query.trim()));
                }
            } catch (err: any) {
                console.error("Google forward geocode error, falling back to Nominatim:", err.message);
            }
        }

        const { viewbox, ...extraParams } = options;
        const response = await this.httpClient.get("https://nominatim.openstreetmap.org/search", {
            params: { format: "json", q: query.trim(), ...(viewbox ? { viewbox } : {}), ...extraParams },
            headers: { "User-Agent": "AthithyaApp/1.0 (athithya.in)" }
        });
        return response.data;
    }
}

export const geocodingService = GeocodingService.getInstance();
