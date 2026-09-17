const TAVILY_URL = 'https://api.tavily.com/search';

export async function tavilySearch(query, { apiKey, maxResults = 4 }) {
  if (!apiKey) throw new Error('Server is not configured with a TAVILY_API_KEY.');

  try {
    const res = await fetch(TAVILY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        search_depth: 'basic',
        max_results: maxResults,
      }),
    });

    if (!res.ok) {
      console.error(`[tavily] search failed (${res.status}) for query: ${query}`);
      return [];
    }

    const data = await res.json();
    return (data.results || []).map((r) => ({
      title: r.title || 'Untitled',
      url: r.url,
      content: (r.content || '').slice(0, 1200),
    }));
  } catch (err) {
    console.error(`[tavily] search error for query "${query}": ${err.message}`);
    return [];
  }
}

export async function searchMany(queries, { apiKey, maxQueries = 2, maxResultsPerQuery = 4 }) {
  const uniqueQueries = [...new Set(queries.filter(Boolean))].slice(0, maxQueries);
  const resultSets = await Promise.all(uniqueQueries.map((q) => tavilySearch(q, { apiKey, maxResults: maxResultsPerQuery })));

  const seen = new Set();
  const merged = [];
  for (const results of resultSets) {
    for (const r of results) {
      if (!r.url || seen.has(r.url)) continue;
      seen.add(r.url);
      merged.push(r);
    }
  }
  return merged;
}
