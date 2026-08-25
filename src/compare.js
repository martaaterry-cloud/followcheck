export function compareSnapshots(previous, current){
  const prevFollowers = new Set(previous?.followers || []);
  const currFollowers = new Set(current?.followers || []);
  return {
    unfollowed: [...prevFollowers].filter(u => !currFollowers.has(u)).sort(),
    newFollowers: [...currFollowers].filter(u => !prevFollowers.has(u)).sort(),
  };
}

export function calculateNotFollowingBack(snapshot){
  const followers = new Set(snapshot?.followers || []);
  return (snapshot?.following || [])
    .filter(u => !followers.has(u))
    .sort();
}
