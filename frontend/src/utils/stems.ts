/* Give machine-named Demucs stems a stable, readable presentation order. */

// This is the order requested for the six-source htdemucs_6s model. `as const`
// preserves the exact string values instead of widening the array to string[].
const preferredStemOrder = [
  "vocals",
  "piano",
  "guitar",
  "drums",
  "bass",
  "other",
] as const;

// Map each preferred name to a numeric position. Looking up a position in a Map
// avoids repeatedly scanning the complete order array during sorting.
const preferredStemPositions = new Map<string, number>(
  preferredStemOrder.map((stemName, index) => [stemName, index]),
);

export function orderStemEntries(
  downloadUrls: Record<string, string>,
): [string, string][] {
  // Object.entries converts the URL map into sortable [stemName, url] pairs.
  return Object.entries(downloadUrls).sort(([leftName], [rightName]) => {
    // Number.POSITIVE_INFINITY places a model's unfamiliar stem after all six
    // recognized names without discarding it from the results page.
    const leftPosition =
      preferredStemPositions.get(leftName.toLowerCase()) ??
      Number.POSITIVE_INFINITY;
    const rightPosition =
      preferredStemPositions.get(rightName.toLowerCase()) ??
      Number.POSITIVE_INFINITY;

    if (leftPosition !== rightPosition) {
      return leftPosition - rightPosition;
    }

    // Unknown stems share Infinity, so alphabetic ordering keeps them stable.
    return leftName.localeCompare(rightName);
  });
}

export function formatStemName(stemName: string): string {
  // Models may use underscores or hyphens in names. Convert both separators to
  // spaces, then capitalize each resulting word for a human-readable heading.
  return stemName
    .replaceAll(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}
