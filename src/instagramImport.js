import JSZip from 'jszip';

export function extractUsername(entry) {
  if (!entry) return null;

  // Si tiene string_list_data (formato estándar de exportación de Instagram)
  if (Array.isArray(entry.string_list_data) && entry.string_list_data.length > 0) {
    const d = entry.string_list_data[0] || {};
    if (d.value && String(d.value).trim()) {
      return String(d.value).trim().toLowerCase();
    }
    if (d.href) {
      const m = String(d.href).match(/instagram\.com\/(?:_u\/)?([^/?#]+)/i);
      if (m && m[1].trim()) return m[1].trim().toLowerCase();
    }
  }

  // Fallback si viene en title o value directo
  if (typeof entry.value === 'string' && entry.value.trim()) {
    return entry.value.trim().toLowerCase();
  }
  if (typeof entry.title === 'string' && entry.title.trim()) {
    return entry.title.trim().toLowerCase();
  }

  return null;
}

export async function parseInstagramZip(file) {
  const zip = await JSZip.loadAsync(file);
  const names = Object.keys(zip.files);

  const followingPath = names.find(n =>
    /(?:^|\/)following\.json$/i.test(n) && !zip.files[n].dir
  );
  const followerPaths = names.filter(n =>
    /(?:^|\/)followers_\d+\.json$/i.test(n) && !zip.files[n].dir
  );

  if (!followingPath || !followerPaths.length) {
    throw new Error("El ZIP no contiene Seguidores y seguidos en formato JSON.");
  }

  const followingContent = await zip.file(followingPath).async("string");
  const followingRaw = JSON.parse(followingContent);
  const followingItems = Array.isArray(followingRaw)
    ? followingRaw
    : (followingRaw.relationships_following || []);

  const following = [...new Set(
    followingItems.map(extractUsername).filter(Boolean)
  )];

  let followersList = [];
  for (const path of followerPaths) {
    const followerContent = await zip.file(path).async("string");
    const followerRaw = JSON.parse(followerContent);
    const items = Array.isArray(followerRaw)
      ? followerRaw
      : (followerRaw.relationships_followers || []);

    followersList.push(...items.map(extractUsername).filter(Boolean));
  }
  const followers = [...new Set(followersList)];

  return {
    importedAt: new Date().toISOString(),
    followers,
    following
  };
}
