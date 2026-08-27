// Catálogo curado local de cuentas públicas, marcas y figuras de alta relevancia.
// Estructura extensible para detección offline sin scraping ni llamadas externas.

export const KNOWN_RELEVANT_ACCOUNTS = {
  // Deportes & Atletas
  'leomessi': { name: 'Lionel Messi', category: 'deportistas', confidence: 0.98 },
  'cristiano': { name: 'Cristiano Ronaldo', category: 'deportistas', confidence: 0.98 },
  'realmadrid': { name: 'Real Madrid C.F.', category: 'clubs_deportivos', confidence: 0.98 },
  'fcbarcelona': { name: 'FC Barcelona', category: 'clubs_deportivos', confidence: 0.98 },
  'rafaelnadal': { name: 'Rafael Nadal', category: 'deportistas', confidence: 0.98 },
  'nba': { name: 'NBA', category: 'deportes', confidence: 0.98 },
  'formula1': { name: 'Formula 1', category: 'deportes', confidence: 0.98 },
  'carlosalcarazz': { name: 'Carlos Alcaraz', category: 'deportistas', confidence: 0.98 },
  'championsleague': { name: 'UEFA Champions League', category: 'deportes', confidence: 0.98 },

  // Artistas & Músicos
  'shakira': { name: 'Shakira', category: 'artistas', confidence: 0.98 },
  'badbunnypr': { name: 'Bad Bunny', category: 'artistas', confidence: 0.98 },
  'taylorswift': { name: 'Taylor Swift', category: 'artistas', confidence: 0.98 },
  'rosalia.vt': { name: 'Rosalía', category: 'artistas', confidence: 0.98 },
  'billieeilish': { name: 'Billie Eilish', category: 'artistas', confidence: 0.98 },
  'dualipa': { name: 'Dua Lipa', category: 'artistas', confidence: 0.98 },
  'arianagrande': { name: 'Ariana Grande', category: 'artistas', confidence: 0.98 },
  'selenagomez': { name: 'Selena Gomez', category: 'artistas', confidence: 0.98 },
  'beyonce': { name: 'Beyoncé', category: 'artistas', confidence: 0.98 },

  // Marcas & Empresas
  'nike': { name: 'Nike', category: 'marcas', confidence: 0.98 },
  'adidas': { name: 'Adidas', category: 'marcas', confidence: 0.98 },
  'apple': { name: 'Apple', category: 'marcas', confidence: 0.98 },
  'spotify': { name: 'Spotify', category: 'marcas', confidence: 0.98 },
  'netflix': { name: 'Netflix', category: 'medios', confidence: 0.98 },
  'netflixes': { name: 'Netflix España', category: 'medios', confidence: 0.98 },
  'zara': { name: 'Zara', category: 'marcas', confidence: 0.98 },
  'pullandbear': { name: 'Pull&Bear', category: 'marcas', confidence: 0.98 },
  'bershka': { name: 'Bershka', category: 'marcas', confidence: 0.98 },
  'stradivarius': { name: 'Stradivarius', category: 'marcas', confidence: 0.98 },
  'mango': { name: 'Mango', category: 'marcas', confidence: 0.98 },
  'starbucks': { name: 'Starbucks', category: 'marcas', confidence: 0.98 },
  'mcdonalds': { name: 'McDonalds', category: 'marcas', confidence: 0.98 },
  'redbull': { name: 'Red Bull', category: 'marcas', confidence: 0.98 },
  'playstation': { name: 'PlayStation', category: 'marcas', confidence: 0.98 },
  'playstationes': { name: 'PlayStation España', category: 'marcas', confidence: 0.98 },
  'instagram': { name: 'Instagram Oficial', category: 'marcas', confidence: 0.98 },

  // Medios & Divulgación
  'natgeo': { name: 'National Geographic', category: 'medios', confidence: 0.98 },
  'el_pais': { name: 'El País', category: 'medios', confidence: 0.98 },
  'bbcnews': { name: 'BBC News', category: 'medios', confidence: 0.98 },
  'nasa': { name: 'NASA', category: 'instituciones', confidence: 0.98 },

  // Creadores muy conocidos
  'ibai': { name: 'Ibai Llanos', category: 'creadores', confidence: 0.98 },
  'auronplay': { name: 'AuronPlay', category: 'creadores', confidence: 0.98 },
  'elrubiuswtf': { name: 'Rubius', category: 'creadores', confidence: 0.98 },
  'mrbeast': { name: 'MrBeast', category: 'creadores', confidence: 0.98 },
  'thegrefg': { name: 'TheGrefg', category: 'creadores', confidence: 0.98 },
  'illojuan': { name: 'IlloJuan', category: 'creadores', confidence: 0.98 }
};
