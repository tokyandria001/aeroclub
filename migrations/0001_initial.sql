-- Schéma initial de l'aéroclub (déjà appliqué sur la base distante).
-- Écrit avec IF NOT EXISTS pour pouvoir être rejoué sans erreur.

CREATE TABLE IF NOT EXISTS instructeurs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nom TEXT NOT NULL,
  prenom TEXT NOT NULL,
  email TEXT UNIQUE,
  telephone TEXT,
  actif INTEGER NOT NULL DEFAULT 1,
  cree_le TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS avions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  immatriculation TEXT NOT NULL UNIQUE,
  modele TEXT NOT NULL,
  places_passagers INTEGER NOT NULL DEFAULT 1,
  actif INTEGER NOT NULL DEFAULT 1,
  cree_le TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS baptemes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nom TEXT NOT NULL,
  prenom TEXT NOT NULL,
  email TEXT NOT NULL,
  telephone TEXT,
  nb_passagers INTEGER NOT NULL DEFAULT 1 CHECK (nb_passagers BETWEEN 1 AND 3),
  poids_total_kg INTEGER,
  periode_souhaitee TEXT,
  message TEXT,
  statut TEXT NOT NULL DEFAULT 'nouvelle' CHECK (statut IN ('nouvelle','contactee','planifiee','effectuee','annulee')),
  date_vol TEXT,
  instructeur_id INTEGER REFERENCES instructeurs(id),
  avion_id INTEGER REFERENCES avions(id),
  notes_internes TEXT,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  modifie_le TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS eleves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nom TEXT NOT NULL,
  prenom TEXT NOT NULL,
  email TEXT UNIQUE,
  telephone TEXT,
  date_naissance TEXT,
  date_inscription TEXT NOT NULL DEFAULT (date('now')),
  instructeur_id INTEGER REFERENCES instructeurs(id),
  validite_medical TEXT,
  statut TEXT NOT NULL DEFAULT 'en_formation' CHECK (statut IN ('en_formation','theorique_obtenu','lache_solo','test_programme','brevete','abandon')),
  date_examen_theorique TEXT,
  date_premier_solo TEXT,
  date_test_vol TEXT,
  notes TEXT,
  cree_le TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vols_formation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  eleve_id INTEGER NOT NULL REFERENCES eleves(id) ON DELETE CASCADE,
  instructeur_id INTEGER REFERENCES instructeurs(id),
  avion_id INTEGER REFERENCES avions(id),
  date_vol TEXT NOT NULL,
  duree_minutes INTEGER NOT NULL CHECK (duree_minutes > 0),
  solo INTEGER NOT NULL DEFAULT 0,
  exercices TEXT,
  commentaire TEXT,
  cree_le TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_baptemes_statut ON baptemes(statut);
CREATE INDEX IF NOT EXISTS idx_eleves_statut ON eleves(statut);
CREATE INDEX IF NOT EXISTS idx_vols_eleve ON vols_formation(eleve_id, date_vol);

CREATE VIEW IF NOT EXISTS progression_eleves AS
SELECT e.id, e.prenom, e.nom, e.statut, e.validite_medical,
  COALESCE(SUM(v.duree_minutes),0)/60.0 AS heures_total,
  COALESCE(SUM(CASE WHEN v.solo=0 THEN v.duree_minutes END),0)/60.0 AS heures_double,
  COALESCE(SUM(CASE WHEN v.solo=1 THEN v.duree_minutes END),0)/60.0 AS heures_solo,
  COUNT(v.id) AS nb_vols,
  MAX(v.date_vol) AS dernier_vol
FROM eleves e LEFT JOIN vols_formation v ON v.eleve_id = e.id
GROUP BY e.id;
