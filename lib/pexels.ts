export async function searchPexelsImage(query: string): Promise<string | null> {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1`,
      {
        headers: { Authorization: apiKey },
        // a hung Pexels must not stall todo creation; imageUrl is nullable
        signal: AbortSignal.timeout(3000),
      }
    );
    if (!res.ok) return null;

    const data = await res.json();
    return data.photos?.[0]?.src?.medium ?? null;
  } catch {
    return null;
  }
}
