export function jsonResult(data: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
    structuredContent: normalizeStructuredContent(data),
  };
}

function normalizeStructuredContent(data: unknown) {
  if (Array.isArray(data)) {
    return { records: data };
  }

  if (data !== null && typeof data === 'object') return data as Record<string, unknown>;
  return { value: data };
}
