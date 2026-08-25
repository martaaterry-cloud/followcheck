import JSZip from 'jszip';

function extractUsername(entry){
  if (!entry?.string_list_data?.length) return null;
  const d = entry.string_list_data[0] || {};
  if (d.value) return String(d.value).trim().toLowerCase();
  if (d.href){
    const m = String(d.href).match(/instagram\.com\/(?:_u\/)?([^/?#]+)/i);
    if (m) return m[1].trim().toLowerCase();
  }
  return null;
}

export async function parseInstagramZip(file){
  const zip = await JSZip.loadAsync(file);
  const names = Object.keys(zip.files);

  const followingPath = names.find(n =>
    /connections\/followers_and_following\/following\.json$/i.test(n)
  );
  const followerPaths = names.filter(n =>
    /connections\/followers_and_following\/followers_\d+\.json$/i.test(n)
  );

  if (!followingPath || !followerPaths.length){
    throw new Error("El ZIP no contiene Seguidores y seguidos en formato JSON.");
  }

  const followingRaw = JSON.parse(await zip.file(followingPath).async("string"));
  const following = [...new Set(
    (followingRaw.relationships_following || [])
      .map(extractUsername)
      .filter(Boolean)
  )];

  let followers = [];
  for (const path of followerPaths){
    const arr = JSON.parse(await zip.file(path).async("string"));
    followers.push(...arr.map(extractUsername).filter(Boolean));
  }
  followers = [...new Set(followers)];

  return {
    importedAt: new Date().toISOString(),
    followers,
    following
  };
}
