export type PlaceCandidate = {
  placeId: string;
  name: string;
  formattedAddress: string;
  lat: number;
  lng: number;
};

const PLACES_TEXT_SEARCH = "https://places.googleapis.com/v1/places:searchText";
const PLACE_DETAILS = "https://places.googleapis.com/v1/places";

function apiKey(): string {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new Error("GOOGLE_PLACES_API_KEY is not set");
  return key;
}

export async function searchPlaces(query: string): Promise<PlaceCandidate[]> {
  const res = await fetch(PLACES_TEXT_SEARCH, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey(),
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.location",
    },
    body: JSON.stringify({ textQuery: query, maxResultCount: 5 }),
  });
  if (!res.ok) {
    throw new Error(`Places searchText failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as {
    places?: Array<{
      id: string;
      displayName?: { text?: string };
      formattedAddress?: string;
      location?: { latitude: number; longitude: number };
    }>;
  };
  return (json.places ?? [])
    .filter((p) => p.location)
    .map((p) => ({
      placeId: p.id,
      name: p.displayName?.text ?? "",
      formattedAddress: p.formattedAddress ?? "",
      lat: p.location!.latitude,
      lng: p.location!.longitude,
    }));
}

export async function getPlaceDetails(placeId: string): Promise<PlaceCandidate | null> {
  const res = await fetch(`${PLACE_DETAILS}/${encodeURIComponent(placeId)}`, {
    method: "GET",
    headers: {
      "X-Goog-Api-Key": apiKey(),
      "X-Goog-FieldMask": "id,displayName,formattedAddress,location",
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Places details failed: ${res.status} ${await res.text()}`);
  }
  const p = (await res.json()) as {
    id: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    location?: { latitude: number; longitude: number };
  };
  if (!p.location) return null;
  return {
    placeId: p.id,
    name: p.displayName?.text ?? "",
    formattedAddress: p.formattedAddress ?? "",
    lat: p.location.latitude,
    lng: p.location.longitude,
  };
}
