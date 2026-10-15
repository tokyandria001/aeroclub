// API de l'aéroclub — Cloudflare Worker + D1
// Les fichiers du dossier public/ sont servis automatiquement ;
// ce Worker ne reçoit que les requêtes qui ne correspondent à aucun fichier (ex. /api/...).

const SESSION_DUREE_S = 7 * 24 * 3600; // 7 jours

const STATUTS_BAPTEME = ["nouvelle", "contactee", "planifiee", "effectuee", "annulee"];
const STATUTS_ELEVE = ["en_formation", "theorique_obtenu", "lache_solo", "test_programme", "brevete", "abandon"];

// ---------- Utilitaires ----------

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });

async function lireJson(request) {
  const type = request.headers.get("content-type") || "";
  if (!type.includes("application/json")) throw new HttpError(415, "Format JSON attendu");
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "JSON invalide");
  }
}

// Validateurs : chacun reçoit la valeur brute et renvoie la valeur nettoyée (ou null si vide)
const V = {
  texte: (max) => (v, champ) => {
    if (v === undefined || v === null || String(v).trim() === "") return null;
    const s = String(v).trim();
    if (s.length > max) throw new HttpError(400, `${champ} : ${max} caractères maximum`);
    return s;
  },
  email: (v, champ) => {
    if (v === undefined || v === null || String(v).trim() === "") return null;
    const s = String(v).trim().toLowerCase();
    if (s.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new HttpError(400, `${champ} : adresse email invalide`);
    return s;
  },
  entier: (min, max) => (v, champ) => {
    if (v === undefined || v === null || v === "") return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${champ} : nombre entre ${min} et ${max} attendu`);
    return n;
  },
  booleen: (v) => (v === undefined || v === null ? null : v === true || v === 1 || v === "1" || v === "true" || v === "on" ? 1 : 0),
  date: (v, champ) => {
    if (v === undefined || v === null || v === "") return null;
    const s = String(v).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || isNaN(Date.parse(s))) throw new HttpError(400, `${champ} : date AAAA-MM-JJ attendue`);
    return s;
  },
  dateHeure: (v, champ) => {
    if (v === undefined || v === null || v === "") return null;
    const s = String(v).trim();
    if (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})?$/.test(s)) throw new HttpError(400, `${champ} : date (et heure) invalide`);
    return s.replace(" ", "T");
  },
  choix: (liste) => (v, champ) => {
    if (v === undefined || v === null || v === "") return null;
    if (!liste.includes(v)) throw new HttpError(400, `${champ} : valeur non autorisée`);
    return v;
  },
};

// Schémas des champs modifiables par table (liste blanche)
const CHAMPS = {
  baptemes: {
    nom: V.texte(100), prenom: V.texte(100), email: V.email, telephone: V.texte(30),
    nb_passagers: V.entier(1, 3), poids_total_kg: V.entier(1, 400),
    periode_souhaitee: V.texte(200), message: V.texte(2000),
    statut: V.choix(STATUTS_BAPTEME), date_vol: V.dateHeure,
    instructeur_id: V.entier(1, 1e9), avion_id: V.entier(1, 1e9), notes_internes: V.texte(4000),
  },
  eleves: {
    nom: V.texte(100), prenom: V.texte(100), email: V.email, telephone: V.texte(30),
    date_naissance: V.date, date_inscription: V.date, instructeur_id: V.entier(1, 1e9),
    validite_medical: V.date, statut: V.choix(STATUTS_ELEVE),
    date_examen_theorique: V.date, date_premier_solo: V.date, date_test_vol: V.date, notes: V.texte(4000),
  },
  vols_formation: {
    eleve_id: V.entier(1, 1e9), instructeur_id: V.entier(1, 1e9), avion_id: V.entier(1, 1e9),
    date_vol: V.date, duree_minutes: V.entier(1, 1440), solo: V.booleen,
    exercices: V.texte(1000), commentaire: V.texte(2000),
  },
  instructeurs: {
    nom: V.texte(100), prenom: V.texte(100), email: V.email, telephone: V.texte(30), actif: V.booleen,
  },
  avions: {
    immatriculation: V.texte(20), modele: V.texte(100), places_passagers: V.entier(1, 9), actif: V.booleen,
  },
};

const OBLIGATOIRES = {
  baptemes: ["nom", "prenom", "email"],
  eleves: ["nom", "prenom"],
  vols_formation: ["eleve_id", "date_vol", "duree_minutes"],
  instructeurs: ["nom", "prenom"],
  avions: ["immatriculation", "modele"],
};

const LIBELLES = {
  nom: "Nom", prenom: "Prénom", email: "Email", eleve_id: "Élève", date_vol: "Date du vol",
  duree_minutes: "Durée", immatriculation: "Immatriculation", modele: "Modèle",
};

// Nettoie un objet reçu selon le schéma. `partiel` = mise à jour (seuls les champs présents).
function nettoyer(table, data, partiel) {
  if (!data || typeof data !== "object") throw new HttpError(400, "Données manquantes");
  const schema = CHAMPS[table];
  const out = {};
  for (const [champ, valider] of Object.entries(schema)) {
    if (partiel && !(champ in data)) continue;
    out[champ] = valider(data[champ], LIBELLES[champ] || champ);
  }
  const obligatoires = OBLIGATOIRES[table];
  for (const champ of obligatoires) {
    if ((!partiel || champ in out) && (out[champ] === null || out[champ] === undefined)) {
      throw new HttpError(400, `${LIBELLES[champ] || champ} : champ obligatoire`);
    }
  }
  if (table === "avions" && out.immatriculation) out.immatriculation = out.immatriculation.toUpperCase();
  return out;
}

async function inserer(env, table, valeurs) {
  const cols = Object.keys(valeurs).filter((c) => valeurs[c] !== null && valeurs[c] !== undefined);
  const sql = `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")}) RETURNING *`;
  try {
    return await env.DB.prepare(sql).bind(...cols.map((c) => valeurs[c])).first();
  } catch (e) {
    throw traduireErreurSql(e);
  }
}

async function modifier(env, table, id, valeurs) {
  const cols = Object.keys(valeurs);
  if (cols.length === 0) throw new HttpError(400, "Rien à modifier");
  const extra = table === "baptemes" ? ", modifie_le = datetime('now')" : "";
  const sql = `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(", ")}${extra} WHERE id = ? RETURNING *`;
  let ligne;
  try {
    ligne = await env.DB.prepare(sql).bind(...cols.map((c) => valeurs[c]), id).first();
  } catch (e) {
    throw traduireErreurSql(e);
  }
  if (!ligne) throw new HttpError(404, "Introuvable");
  return ligne;
}

async function supprimer(env, table, id) {
  try {
    const r = await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
    if (!r.meta.changes) throw new HttpError(404, "Introuvable");
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw traduireErreurSql(e);
  }
}

function traduireErreurSql(e) {
  const msg = String(e && e.message);
  if (msg.includes("UNIQUE")) return new HttpError(409, "Cette valeur existe déjà (email ou immatriculation en double)");
  if (msg.includes("FOREIGN KEY")) return new HttpError(409, "Élément lié à d'autres données : impossible de le supprimer. Désactivez-le plutôt.");
  if (msg.includes("CHECK")) return new HttpError(400, "Valeur non autorisée");
  console.error(e);
  return new HttpError(500, "Erreur de base de données");
}

// ---------- Authentification (mot de passe unique du bureau) ----------

const enc = new TextEncoder();

async function cleHmac(secret) {
  return crypto.subtle.importKey("raw", enc.encode("aeroclub-session:" + secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function egalTempsConstant(a, b) {
  const ba = enc.encode(a), bb = enc.encode(b);
  let diff = ba.length ^ bb.length;
  for (let i = 0; i < Math.max(ba.length, bb.length); i++) diff |= (ba[i] || 0) ^ (bb[i] || 0);
  return diff === 0;
}

async function creerJeton(env) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DUREE_S;
  const sig = await crypto.subtle.sign("HMAC", await cleHmac(env.ADMIN_PASSWORD), enc.encode(String(exp)));
  return `${exp}.${b64url(sig)}`;
}

async function sessionValide(request, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const cookie = request.headers.get("cookie") || "";
  const m = cookie.match(/(?:^|;\s*)session=([^;]+)/);
  if (!m) return false;
  const [exp, sig] = m[1].split(".");
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  const attendu = b64url(await crypto.subtle.sign("HMAC", await cleHmac(env.ADMIN_PASSWORD), enc.encode(exp)));
  return egalTempsConstant(sig, attendu);
}

function cookieSession(valeur, maxAge) {
  return `session=${valeur}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

// ---------- Routes ----------

const routes = [];
const route = (methode, motif, handler, { public: estPublic = false } = {}) => {
  const re = new RegExp("^" + motif.replace(/:(\w+)/g, "(?<$1>\\d+)") + "/?$");
  routes.push({ methode, re, handler, estPublic });
};

// Public : demande de baptême
route("POST", "/api/baptemes", async (req, env) => {
  const data = await lireJson(req);
  if (data.site_web) return json({ ok: true }, 201); // piège à robots (champ caché)
  if (!data.consentement) throw new HttpError(400, "Merci d'accepter l'utilisation de vos données pour traiter la demande");
  const champsPublics = ["nom", "prenom", "email", "telephone", "nb_passagers", "poids_total_kg", "periode_souhaitee", "message"];
  const filtre = Object.fromEntries(champsPublics.map((c) => [c, data[c]]));
  const valeurs = nettoyer("baptemes", filtre, false);
  if (!valeurs.telephone) throw new HttpError(400, "Téléphone : champ obligatoire");
  const ligne = await inserer(env, "baptemes", valeurs);
  return json({ ok: true, id: ligne.id }, 201);
}, { public: true });

// Session
route("POST", "/api/login", async (req, env) => {
  if (!env.ADMIN_PASSWORD) throw new HttpError(503, "Le mot de passe administrateur n'est pas encore configuré (secret ADMIN_PASSWORD).");
  const { password } = await lireJson(req);
  if (typeof password !== "string" || !egalTempsConstant(password, env.ADMIN_PASSWORD)) {
    await new Promise((r) => setTimeout(r, 800)); // ralentit les essais en série
    throw new HttpError(401, "Mot de passe incorrect");
  }
  return json({ ok: true }, 200, { "set-cookie": cookieSession(await creerJeton(env), SESSION_DUREE_S) });
}, { public: true });

route("POST", "/api/logout", async () => json({ ok: true }, 200, { "set-cookie": cookieSession("", 0) }), { public: true });

route("GET", "/api/session", async (req, env) => json({ connecte: await sessionValide(req, env), configure: !!env.ADMIN_PASSWORD }), { public: true });

// Tableau de bord
route("GET", "/api/stats", async (req, env) => {
  const [baptemes, eleves, medical] = await env.DB.batch([
    env.DB.prepare("SELECT statut, COUNT(*) AS n FROM baptemes GROUP BY statut"),
    env.DB.prepare("SELECT statut, COUNT(*) AS n FROM eleves GROUP BY statut"),
    env.DB.prepare("SELECT id, prenom, nom, validite_medical FROM eleves WHERE statut NOT IN ('brevete','abandon') AND validite_medical IS NOT NULL AND validite_medical <= date('now','+30 days') ORDER BY validite_medical"),
  ]);
  return json({ baptemes: baptemes.results, eleves: eleves.results, medical_a_renouveler: medical.results });
});

// Baptêmes
route("GET", "/api/baptemes", async (req, env) => {
  const statut = new URL(req.url).searchParams.get("statut");
  let sql = `SELECT b.*, i.prenom || ' ' || i.nom AS instructeur, a.immatriculation AS avion
             FROM baptemes b LEFT JOIN instructeurs i ON i.id = b.instructeur_id LEFT JOIN avions a ON a.id = b.avion_id`;
  const params = [];
  if (statut && STATUTS_BAPTEME.includes(statut)) { sql += " WHERE b.statut = ?"; params.push(statut); }
  sql += " ORDER BY CASE b.statut WHEN 'nouvelle' THEN 0 WHEN 'contactee' THEN 1 WHEN 'planifiee' THEN 2 ELSE 3 END, COALESCE(b.date_vol, b.cree_le) DESC LIMIT 500";
  const { results } = await env.DB.prepare(sql).bind(...params).all();
  return json(results);
});
route("PATCH", "/api/baptemes/:id", async (req, env, p) => json(await modifier(env, "baptemes", Number(p.id), nettoyer("baptemes", await lireJson(req), true))));
route("DELETE", "/api/baptemes/:id", async (req, env, p) => { await supprimer(env, "baptemes", Number(p.id)); return json({ ok: true }); });

// Élèves
route("GET", "/api/eleves", async (req, env) => {
  const { results } = await env.DB.prepare(
    `SELECT e.*, p.heures_total, p.heures_double, p.heures_solo, p.nb_vols, p.dernier_vol,
            i.prenom || ' ' || i.nom AS instructeur
     FROM eleves e JOIN progression_eleves p ON p.id = e.id LEFT JOIN instructeurs i ON i.id = e.instructeur_id
     ORDER BY CASE e.statut WHEN 'brevete' THEN 1 WHEN 'abandon' THEN 2 ELSE 0 END, e.nom, e.prenom`
  ).all();
  return json(results);
});
route("POST", "/api/eleves", async (req, env) => json(await inserer(env, "eleves", nettoyer("eleves", await lireJson(req), false)), 201));
route("PATCH", "/api/eleves/:id", async (req, env, p) => json(await modifier(env, "eleves", Number(p.id), nettoyer("eleves", await lireJson(req), true))));
route("DELETE", "/api/eleves/:id", async (req, env, p) => {
  const id = Number(p.id);
  await env.DB.prepare("DELETE FROM vols_formation WHERE eleve_id = ?").bind(id).run();
  await supprimer(env, "eleves", id);
  return json({ ok: true });
});

// Vols de formation
route("GET", "/api/eleves/:id/vols", async (req, env, p) => {
  const { results } = await env.DB.prepare(
    `SELECT v.*, i.prenom || ' ' || i.nom AS instructeur, a.immatriculation AS avion
     FROM vols_formation v LEFT JOIN instructeurs i ON i.id = v.instructeur_id LEFT JOIN avions a ON a.id = v.avion_id
     WHERE v.eleve_id = ? ORDER BY v.date_vol DESC, v.id DESC`
  ).bind(Number(p.id)).all();
  return json(results);
});
route("POST", "/api/vols", async (req, env) => json(await inserer(env, "vols_formation", nettoyer("vols_formation", await lireJson(req), false)), 201));
route("DELETE", "/api/vols/:id", async (req, env, p) => { await supprimer(env, "vols_formation", Number(p.id)); return json({ ok: true }); });

// Instructeurs et avions
for (const table of ["instructeurs", "avions"]) {
  const ordre = table === "avions" ? "actif DESC, immatriculation" : "actif DESC, nom, prenom";
  route("GET", `/api/${table}`, async (req, env) => json((await env.DB.prepare(`SELECT * FROM ${table} ORDER BY ${ordre}`).all()).results));
  route("POST", `/api/${table}`, async (req, env) => json(await inserer(env, table, nettoyer(table, await lireJson(req), false)), 201));
  route("PATCH", `/api/${table}/:id`, async (req, env, p) => json(await modifier(env, table, Number(p.id), nettoyer(table, await lireJson(req), true))));
  route("DELETE", `/api/${table}/:id`, async (req, env, p) => { await supprimer(env, table, Number(p.id)); return json({ ok: true }); });
}

// ---------- Point d'entrée ----------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return new Response("Page introuvable", { status: 404 });

    try {
      for (const r of routes) {
        if (r.methode !== request.method) continue;
        const m = url.pathname.match(r.re);
        if (!m) continue;
        if (!r.estPublic && !(await sessionValide(request, env))) throw new HttpError(401, "Connexion requise");
        return await r.handler(request, env, m.groups || {});
      }
      throw new HttpError(404, "Route inconnue");
    } catch (e) {
      if (e instanceof HttpError) return json({ erreur: e.message }, e.status);
      console.error(e);
      return json({ erreur: "Erreur interne" }, 500);
    }
  },
};
