import { normalizeGoogleLocationId } from '@/lib/integrations/google/multilocal';

export type GoogleLocationCandidate = {
  location_id: string;
  resource_name: string;
  account_name: string | null;
  title: string;
  address: string | null;
  city: string | null;
  country: string | null;
  primary_phone: string | null;
  website_uri: string | null;
  profile_photo_url: string | null;
};

export type GoogleLocationsFetchResult = {
  locations: GoogleLocationCandidate[];
  httpStatus: number;
  errorCode: string | null;
  errorMessage: string | null;
};

type GoogleApiResponse = {
  accounts?: Array<{ name?: string | null }>;
  locations?: Array<Record<string, unknown>>;
  nextPageToken?: string;
  error?: {
    status?: string;
    message?: string;
  };
};

const ACCOUNTS_ENDPOINT = 'https://mybusinessaccountmanagement.googleapis.com/v1/accounts';
const LOCATIONS_READ_MASK = [
  'name',
  'title',
  'storeCode',
  'websiteUri',
  'primaryPhone',
  'storefrontAddress',
].join(',');

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseAddress(location: Record<string, unknown>): {
  address: string | null;
  city: string | null;
  country: string | null;
} {
  const storefrontAddress = (location.storefrontAddress || null) as Record<string, unknown> | null;
  if (!storefrontAddress) return { address: null, city: null, country: null };

  const lines = Array.isArray(storefrontAddress.addressLines)
    ? storefrontAddress.addressLines.filter((entry): entry is string => typeof entry === 'string')
    : [];
  const city = asString(storefrontAddress.locality);
  const country = asString(storefrontAddress.regionCode);
  const fullAddress = lines.length > 0 ? lines.join(', ') : null;
  return { address: fullAddress, city, country };
}

function toLocationCandidate(raw: Record<string, unknown>, accountName: string): GoogleLocationCandidate | null {
  const resourceName = asString(raw.name);
  if (!resourceName) return null;

  const locationId = normalizeGoogleLocationId(resourceName);
  if (!locationId) return null;

  const title =
    asString(raw.title)
    || asString(raw.storeCode)
    || `Local ${locationId}`;

  const { address, city, country } = parseAddress(raw);

  return {
    location_id: locationId,
    resource_name: resourceName,
    account_name: accountName || null,
    title,
    address,
    city,
    country,
    primary_phone: asString(raw.primaryPhone),
    website_uri: asString(raw.websiteUri),
    profile_photo_url: null,
  };
}

async function googleGet(url: string, accessToken: string): Promise<{
  status: number;
  payload: GoogleApiResponse | null;
}> {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  const text = await response.text();
  if (!text) return { status: response.status, payload: null };

  try {
    const payload = JSON.parse(text) as GoogleApiResponse;
    return { status: response.status, payload };
  } catch {
    return { status: response.status, payload: null };
  }
}

function mapGoogleError(payload: GoogleApiResponse | null): { code: string | null; message: string | null } {
  const code = payload?.error?.status || null;
  const message = payload?.error?.message || null;
  return { code, message };
}

export async function listGoogleBusinessLocations(accessToken: string): Promise<GoogleLocationsFetchResult> {
  const accountsResult = await googleGet(ACCOUNTS_ENDPOINT, accessToken);
  if (accountsResult.status < 200 || accountsResult.status >= 300) {
    const mapped = mapGoogleError(accountsResult.payload);
    return {
      locations: [],
      httpStatus: accountsResult.status,
      errorCode: mapped.code,
      errorMessage: mapped.message,
    };
  }

  const accountNames = (accountsResult.payload?.accounts || [])
    .map((entry) => asString(entry.name))
    .filter((entry): entry is string => !!entry);

  if (accountNames.length === 0) {
    return {
      locations: [],
      httpStatus: 200,
      errorCode: null,
      errorMessage: null,
    };
  }

  const deduped = new Map<string, GoogleLocationCandidate>();

  for (const accountName of accountNames) {
    let nextPageToken: string | null = null;
    do {
      const endpoint = new URL(`https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations`);
      endpoint.searchParams.set('readMask', LOCATIONS_READ_MASK);
      endpoint.searchParams.set('pageSize', '100');
      if (nextPageToken) endpoint.searchParams.set('pageToken', nextPageToken);

      const locationsResult = await googleGet(endpoint.toString(), accessToken);
      if (locationsResult.status < 200 || locationsResult.status >= 300) {
        const mapped = mapGoogleError(locationsResult.payload);
        return {
          locations: Array.from(deduped.values()),
          httpStatus: locationsResult.status,
          errorCode: mapped.code,
          errorMessage: mapped.message,
        };
      }

      const rows = Array.isArray(locationsResult.payload?.locations)
        ? locationsResult.payload?.locations || []
        : [];

      for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const candidate = toLocationCandidate(row as Record<string, unknown>, accountName);
        if (!candidate) continue;
        if (!deduped.has(candidate.location_id)) {
          deduped.set(candidate.location_id, candidate);
        }
      }

      nextPageToken = asString(locationsResult.payload?.nextPageToken);
    } while (nextPageToken);
  }

  return {
    locations: Array.from(deduped.values()),
    httpStatus: 200,
    errorCode: null,
    errorMessage: null,
  };
}

export function findGoogleLocationById(
  locations: GoogleLocationCandidate[],
  locationId: string,
): GoogleLocationCandidate | null {
  const normalized = normalizeGoogleLocationId(locationId);
  if (!normalized) return null;

  for (const candidate of locations) {
    if (normalizeGoogleLocationId(candidate.location_id) === normalized) return candidate;
    if (normalizeGoogleLocationId(candidate.resource_name) === normalized) return candidate;
  }
  return null;
}
