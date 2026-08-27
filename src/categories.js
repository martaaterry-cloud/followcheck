export const DEFAULT_CATEGORY_NAMES = [
  'Fútbol',
  'Balonmano',
  'Gimnasio / fitness',
  'Influencers',
  'Restaurantes',
  'Marcas de ropa'
];


function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'cat_' + Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
}

export function initDefaultCategories(existingCategories = []) {
  if (Array.isArray(existingCategories) && existingCategories.length > 0) {
    return [...existingCategories];
  }

  const now = new Date().toISOString();
  return DEFAULT_CATEGORY_NAMES.map((name, index) => ({
    id: generateId(),
    name,
    sortOrder: index,
    createdAt: now,
    updatedAt: now
  }));
}

export function addCategory(categories = [], name) {
  const cleanName = String(name || '').trim();
  if (!cleanName) {
    throw new Error('Introduce un nombre para la categoría.');
  }

  const exists = (categories || []).some(
    c => c.name.toLowerCase().trim() === cleanName.toLowerCase()
  );
  if (exists) {
    throw new Error('Ya existe una categoría con ese nombre.');
  }

  const now = new Date().toISOString();
  const newCat = {
    id: generateId(),
    name: cleanName,
    sortOrder: (categories || []).length,
    createdAt: now,
    updatedAt: now
  };

  return [...(categories || []), newCat];
}

export function renameCategory(categories = [], categoryId, newName) {
  const cleanName = String(newName || '').trim();
  if (!cleanName) {
    throw new Error('Introduce un nombre válido.');
  }

  const exists = (categories || []).some(
    c => c.id !== categoryId && c.name.toLowerCase().trim() === cleanName.toLowerCase()
  );
  if (exists) {
    throw new Error('Ya existe otra categoría con ese nombre.');
  }

  const now = new Date().toISOString();
  return (categories || []).map(cat => {
    if (cat.id === categoryId) {
      return { ...cat, name: cleanName, updatedAt: now };
    }
    return cat;
  });
}

export function deleteCategory(categories = [], memberships = {}, categoryId) {
  const updatedCategories = (categories || []).filter(c => c.id !== categoryId);
  const updatedMemberships = { ...memberships };

  for (const username of Object.keys(updatedMemberships)) {
    const list = updatedMemberships[username] || [];
    if (list.includes(categoryId)) {
      updatedMemberships[username] = list.filter(id => id !== categoryId);
      if (updatedMemberships[username].length === 0) {
        delete updatedMemberships[username];
      }
    }
  }

  return {
    categories: updatedCategories,
    memberships: updatedMemberships
  };
}

export function getAccountCategories(memberships = {}, username) {
  if (!username) return [];
  const normUser = String(username).toLowerCase().trim();
  return Array.isArray(memberships[normUser]) ? memberships[normUser] : [];
}

export function setAccountCategories(memberships = {}, username, categoryIds = []) {
  if (!username) return { ...memberships };
  const normUser = String(username).toLowerCase().trim();
  const updated = { ...memberships };

  const validIds = Array.from(new Set(categoryIds.filter(Boolean)));
  if (validIds.length === 0) {
    delete updated[normUser];
  } else {
    updated[normUser] = validIds;
  }

  return updated;
}

export function toggleAccountCategory(memberships = {}, username, categoryId) {
  if (!username || !categoryId) return { ...memberships };
  const current = getAccountCategories(memberships, username);
  let updatedList;
  if (current.includes(categoryId)) {
    updatedList = current.filter(id => id !== categoryId);
  } else {
    updatedList = [...current, categoryId];
  }
  return setAccountCategories(memberships, username, updatedList);
}

export function isAccountUncategorized(memberships = {}, username) {
  if (!username) return true;
  const categories = getAccountCategories(memberships, username);
  return categories.length === 0;
}

export function countAccountsPerCategory(usernamesList = [], memberships = {}, categories = []) {
  const counts = {
    all: usernamesList.length,
    uncategorized: 0
  };

  for (const cat of categories) {
    counts[cat.id] = 0;
  }

  for (const u of usernamesList) {
    const normUser = String(u).toLowerCase().trim();
    const assignedCats = Array.isArray(memberships[normUser]) ? memberships[normUser] : [];

    if (assignedCats.length === 0) {
      counts.uncategorized += 1;
    } else {
      for (const catId of assignedCats) {
        if (typeof counts[catId] === 'number') {
          counts[catId] += 1;
        }
      }
    }
  }

  return counts;
}
