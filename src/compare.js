export function compareSnapshots(previous, current) {
  if (!previous || !Array.isArray(previous.followers)) {
    return {
      isInitial: true,
      unfollowed: [],
      newFollowers: [],
    };
  }

  const prevFollowers = new Set(previous.followers || []);
  const currFollowers = new Set(current?.followers || []);

  const unfollowed = [...prevFollowers].filter(u => !currFollowers.has(u)).sort();
  const newFollowers = [...currFollowers].filter(u => !prevFollowers.has(u)).sort();

  return {
    isInitial: false,
    unfollowed,
    newFollowers,
  };
}

export function calculateNotFollowingBack(snapshot) {
  const followers = new Set(snapshot?.followers || []);
  return (snapshot?.following || [])
    .filter(u => !followers.has(u))
    .sort();
}
