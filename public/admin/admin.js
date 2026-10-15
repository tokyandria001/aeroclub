// Back-office de l'aéroclub — JavaScript sans dépendance

const STATUTS_BAPTEME = {
  nouvelle: "Nouvelle", contactee: "Contactée", planifiee: "Planifiée", effectuee: "Effectuée", annulee: "Annulée",
};
const STATUTS_ELEVE = {
  en_formation: "En formation", theorique_obtenu: "Théorique obtenu", lache_solo: "Lâché solo",
  test_programme: "Test programmé", brevete: "Breveté", abandon: "Abandon",
};

const $ = (sel, el = document) => el.querySelector(sel);
const contenu = $("#contenu");
const modale = $("#modale");
const formModale = $("#form-modale");

let ref = { instructeurs: [], avions: [] }; // listes de référence
let filtreBaptemes = "";

// ---------- Utilitaires ----------

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function api(methode, chemin, corps) {
  const opts = { method: methode, headers: {} };
  if (corps !== undefined) { opts.headers["content-type"] = "application/json"; opts.body = JSON.stringify(corps); }
  const r = await fetch("/api" + chemin, opts);
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && chemin !== "/login") { afficherConnexion(); throw new Error("Session expirée, reconnectez-vous"); }
  if (!r.ok) throw new Error(data.erreur || "Erreur " + r.status);
  return data;
}

const dateFr = (s) => {
  if (!s) return "—";
  const d = new Date(s.length === 10 ? s + "T00:00" : s.replace(" ", "T"));
  if (isNaN(d)) return esc(s);
  const opts = { day: "2-digit", month: "2-digit", year: "numeric" };
  if (s.length > 10 && s.includes("T")) Object.assign(opts, { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleString("fr-FR", opts);
};
const heures = (h) => {
  const min = Math.round((h || 0) * 60);
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;
};
const pastille = (statut, libelles) => `<span class="pastille p-${esc(statut)}">${esc(libelles[statut] || statut)}</span>`;
const aujourdhui = () => new Date().toISOString().slice(0, 10);

function options(liste, valeur, libelle, vide = "— Non attribué —") {
  return `<option value="">${vide}</option>` + liste
    .filter((x) => x.actif || x.id === valeur)
    .map((x) => `<option value="${x.id}" ${x.id === valeur ? "selected" : ""}>${esc(libelle(x))}</option>`).join("");
}
const nomInstructeur = (i) => `${i.prenom} ${i.nom}`;
const nomAvion = (a) => `${a.immatriculation} — ${a.modele}`;

function champ(nom, libelle, valeur, type = "text", extra = "") {
  return `<div><label for="f-${nom}">${libelle}</label><input id="f-${nom}" name="${nom}" type="${type}" value="${esc(valeur)}" ${extra}></div>`;
}

function lireFormulaire() {
  const data = {};
  for (const el of formModale.elements) {
    if (!el.name) continue;
    data[el.name] = el.type === "checkbox" ? el.checked : el.value;
  }
  return data;
}

function ouvrirModale(html, { onSave, onDelete } = {}) {
  formModale.innerHTML = html + `
    <div id="erreur-modale" class="message erreur" role="alert"></div>
    <div class="actions">
      ${onDelete ? '<button type="button" class="btn danger petit gauche" data-action="supprimer">Supprimer</button>' : ""}
      <button type="button" class="btn secondaire" data-action="fermer">Fermer</button>
      ${onSave ? '<button type="submit" class="btn" data-action="enregistrer">Enregistrer</button>' : ""}
    </div>`;
  const erreur = $("#erreur-modale", formModale);
  const echec = (e) => { erreur.textContent = e.message; erreur.classList.add("visible"); };

  formModale.onsubmit = async (e) => {
    e.preventDefault();
    if (!onSave || !formModale.reportValidity()) return;
    try { await onSave(lireFormulaire()); modale.close(); afficherOnglet(ongletActif); } catch (err) { echec(err); }
  };
  formModale.onclick = async (e) => {
    const action = e.target.dataset && e.target.dataset.action;
    if (action === "fermer") modale.close();
    if (action === "supprimer" && confirm("Supprimer définitivement ? Cette action est irréversible.")) {
      try { await onDelete(); modale.close(); afficherOnglet(ongletActif); } catch (err) { echec(err); }
    }
  };
  modale.showModal();
}

// ---------- Connexion ----------

async function demarrer() {
  try {
    const s = await api("GET", "/session");
    if (s.connecte) return afficherApp();
    if (!s.configure) $("#info-connexion").textContent = "Le mot de passe n'est pas encore configuré : ajoutez le secret ADMIN_PASSWORD dans Cloudflare.";
  } catch {}
  afficherConnexion();
}

function afficherConnexion() {
  $("#ecran-app").hidden = true;
  $("#ecran-connexion").hidden = false;
  $("#password").focus();
}

$("#form-connexion").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#erreur-connexion");
  err.classList.remove("visible");
  try {
    await api("POST", "/login", { password: $("#password").value });
    $("#password").value = "";
    afficherApp();
  } catch (ex) { err.textContent = ex.message; err.classList.add("visible"); }
});

$("#deconnexion").addEventListener("click", async () => { await api("POST", "/logout").catch(() => {}); afficherConnexion(); });

async function afficherApp() {
  $("#ecran-connexion").hidden = true;
  $("#ecran-app").hidden = false;
  afficherOnglet("accueil");
}

// ---------- Onglets ----------

let ongletActif = "accueil";
document.querySelectorAll("[data-onglet]").forEach((b) =>
  b.addEventListener("click", () => afficherOnglet(b.dataset.onglet)));

async function chargerReferences() {
  const [instructeurs, avions] = await Promise.all([api("GET", "/instructeurs"), api("GET", "/avions")]);
  ref = { instructeurs, avions };
}

let numeroAffichage = 0;
async function afficherOnglet(nom) {
  ongletActif = nom;
  const numero = ++numeroAffichage;
  document.querySelectorAll("[data-onglet]").forEach((b) => b.setAttribute("aria-selected", b.dataset.onglet === nom));
  try {
    await chargerReferences();
    if (numero !== numeroAffichage) return; // un autre onglet a été demandé entre-temps
    await { accueil: vueAccueil, baptemes: vueBaptemes, eleves: vueEleves, equipe: vueEquipe }[nom]();
  } catch (e) {
    if (numero !== numeroAffichage) return;
    contenu.innerHTML = `<div class="message erreur visible">${esc(e.message)}</div>`;
  }
}

// ---------- Tableau de bord ----------

async function vueAccueil() {
  const s = await api("GET", "/stats");
  if (ongletActif !== "accueil") return;
  const nb = (liste, statut) => (liste.find((x) => x.statut === statut) || {}).n || 0;
  const enCours = s.eleves.filter((x) => !["brevete", "abandon"].includes(x.statut)).reduce((t, x) => t + x.n, 0);
  contenu.innerHTML = `
    <div class="cartes">
      <div class="carte-stat"><div class="chiffre">${nb(s.baptemes, "nouvelle")}</div><div class="libelle">Demandes de baptême à traiter</div></div>
      <div class="carte-stat"><div class="chiffre">${nb(s.baptemes, "planifiee")}</div><div class="libelle">Baptêmes planifiés</div></div>
      <div class="carte-stat"><div class="chiffre">${nb(s.baptemes, "effectuee")}</div><div class="libelle">Baptêmes effectués</div></div>
      <div class="carte-stat"><div class="chiffre">${enCours}</div><div class="libelle">Élèves en formation</div></div>
      <div class="carte-stat"><div class="chiffre">${nb(s.eleves, "brevete")}</div><div class="libelle">Élèves brevetés</div></div>
    </div>
    <h2>Certificats médicaux à surveiller</h2>
    ${s.medical_a_renouveler.length ? `<div class="defile"><table class="tableau"><thead><tr><th>Élève</th><th>Validité</th></tr></thead><tbody>
      ${s.medical_a_renouveler.map((e) => `<tr><td>${esc(e.prenom)} ${esc(e.nom)}</td>
        <td class="${e.validite_medical < aujourdhui() ? "alerte" : ""}">${dateFr(e.validite_medical)}${e.validite_medical < aujourdhui() ? " (expiré)" : ""}</td></tr>`).join("")}
      </tbody></table></div>` : `<div class="vide">Aucun certificat n'expire dans les 30 prochains jours.</div>`}
    ${!ref.instructeurs.length || !ref.avions.length ? `<p class="message ok visible">Pour commencer, ajoutez vos instructeurs et vos avions dans l'onglet « Instructeurs &amp; avions ».</p>` : ""}`;
}

// ---------- Baptêmes ----------

async function vueBaptemes() {
  const liste = await api("GET", "/baptemes" + (filtreBaptemes ? "?statut=" + filtreBaptemes : ""));
  if (ongletActif !== "baptemes") return;
  contenu.innerHTML = `
    <div class="entete-section">
      <h2>Demandes de baptême</h2>
      <div class="filtres">
        <button data-filtre="" class="${!filtreBaptemes ? "actif" : ""}">Toutes</button>
        ${Object.entries(STATUTS_BAPTEME).map(([k, v]) => `<button data-filtre="${k}" class="${filtreBaptemes === k ? "actif" : ""}">${v}</button>`).join("")}
      </div>
    </div>
    ${liste.length ? `<div class="defile"><table class="tableau">
      <thead><tr><th>Statut</th><th>Demandeur</th><th>Contact</th><th>Pax</th><th>Période souhaitée</th><th>Vol prévu</th><th>Reçue le</th></tr></thead>
      <tbody>${liste.map((b) => `<tr class="cliquable" data-id="${b.id}">
        <td>${pastille(b.statut, STATUTS_BAPTEME)}</td>
        <td><strong>${esc(b.prenom)} ${esc(b.nom)}</strong></td>
        <td>${esc(b.telephone)}<br><span class="aide">${esc(b.email)}</span></td>
        <td class="mono">${b.nb_passagers}${b.poids_total_kg ? ` · ${b.poids_total_kg} kg` : ""}</td>
        <td>${esc(b.periode_souhaitee) || "—"}</td>
        <td>${b.date_vol ? dateFr(b.date_vol) + `<br><span class="aide">${esc(b.avion || "")} ${esc(b.instructeur || "")}</span>` : "—"}</td>
        <td class="mono">${dateFr(b.cree_le.slice(0, 10))}</td>
      </tr>`).join("")}</tbody></table></div>`
    : `<div class="vide">Aucune demande${filtreBaptemes ? " avec ce statut" : " pour l'instant. Elles arriveront ici depuis le formulaire public"}.</div>`}`;

  contenu.querySelectorAll("[data-filtre]").forEach((b) => b.addEventListener("click", () => { filtreBaptemes = b.dataset.filtre; vueBaptemes(); }));
  contenu.querySelectorAll("tr[data-id]").forEach((tr) => tr.addEventListener("click", () => modaleBapteme(liste.find((b) => b.id == tr.dataset.id))));
}

function modaleBapteme(b) {
  ouvrirModale(`
    <h2>Baptême — ${esc(b.prenom)} ${esc(b.nom)}</h2>
    <div class="lecture">
      <div>📞 <a href="tel:${esc(b.telephone)}">${esc(b.telephone)}</a> · ✉️ <a href="mailto:${esc(b.email)}">${esc(b.email)}</a></div>
      <div>${b.nb_passagers} passager(s)${b.poids_total_kg ? `, ${b.poids_total_kg} kg au total` : ""}</div>
      <div>Période souhaitée : ${esc(b.periode_souhaitee) || "—"}</div>
      ${b.message ? `<div>Message : ${esc(b.message)}</div>` : ""}
      <div class="aide">Reçue le ${dateFr(b.cree_le.replace(" ", "T") + "Z")}</div>
    </div>
    <div class="grille">
      <div><label for="f-statut">Statut</label><select id="f-statut" name="statut">
        ${Object.entries(STATUTS_BAPTEME).map(([k, v]) => `<option value="${k}" ${k === b.statut ? "selected" : ""}>${v}</option>`).join("")}</select></div>
      ${champ("date_vol", "Date et heure du vol", b.date_vol ? b.date_vol.slice(0, 16) : "", "datetime-local")}
      <div><label for="f-instructeur_id">Pilote / instructeur</label><select id="f-instructeur_id" name="instructeur_id">${options(ref.instructeurs, b.instructeur_id, nomInstructeur)}</select></div>
      <div><label for="f-avion_id">Avion</label><select id="f-avion_id" name="avion_id">${options(ref.avions, b.avion_id, nomAvion)}</select></div>
      <div class="large"><label for="f-notes">Notes internes</label><textarea id="f-notes" name="notes_internes">${esc(b.notes_internes)}</textarea></div>
    </div>`, {
    onSave: (d) => api("PATCH", "/baptemes/" + b.id, d),
    onDelete: () => api("DELETE", "/baptemes/" + b.id),
  });
}

// ---------- Élèves ----------

async function vueEleves() {
  const liste = await api("GET", "/eleves");
  if (ongletActif !== "eleves") return;
  contenu.innerHTML = `
    <div class="entete-section">
      <h2>Élèves PPL</h2>
      <button class="btn" id="nouvel-eleve">+ Nouvel élève</button>
    </div>
    ${liste.length ? `<div class="defile"><table class="tableau">
      <thead><tr><th>Élève</th><th>Statut</th><th>Instructeur</th><th>Heures (double / solo)</th><th>Vols</th><th>Dernier vol</th><th>Médical</th></tr></thead>
      <tbody>${liste.map((e) => {
        const expire = e.validite_medical && e.validite_medical < aujourdhui();
        return `<tr class="cliquable" data-id="${e.id}">
        <td><strong>${esc(e.prenom)} ${esc(e.nom)}</strong></td>
        <td>${pastille(e.statut, STATUTS_ELEVE)}</td>
        <td>${esc(e.instructeur) || "—"}</td>
        <td class="mono">${heures(e.heures_total)} <span class="aide">(${heures(e.heures_double)} / ${heures(e.heures_solo)})</span></td>
        <td class="mono">${e.nb_vols}</td>
        <td class="mono">${dateFr(e.dernier_vol)}</td>
        <td class="mono ${expire ? "alerte" : ""}">${dateFr(e.validite_medical)}</td></tr>`;
      }).join("")}</tbody></table></div>`
    : `<div class="vide">Aucun élève enregistré.</div>`}`;

  $("#nouvel-eleve").addEventListener("click", () => modaleEleve(null));
  contenu.querySelectorAll("tr[data-id]").forEach((tr) => tr.addEventListener("click", () => modaleEleve(liste.find((e) => e.id == tr.dataset.id))));
}

function champsEleve(e) {
  e = e || { statut: "en_formation", date_inscription: aujourdhui() };
  return `<div class="grille">
    ${champ("prenom", "Prénom *", e.prenom, "text", "required")}
    ${champ("nom", "Nom *", e.nom, "text", "required")}
    ${champ("email", "Email", e.email, "email")}
    ${champ("telephone", "Téléphone", e.telephone, "tel")}
    ${champ("date_naissance", "Date de naissance", e.date_naissance, "date")}
    ${champ("date_inscription", "Date d'inscription", e.date_inscription, "date")}
    <div><label for="f-instructeur_id">Instructeur référent</label><select id="f-instructeur_id" name="instructeur_id">${options(ref.instructeurs, e.instructeur_id, nomInstructeur)}</select></div>
    <div><label for="f-statut">Étape</label><select id="f-statut" name="statut">
      ${Object.entries(STATUTS_ELEVE).map(([k, v]) => `<option value="${k}" ${k === e.statut ? "selected" : ""}>${v}</option>`).join("")}</select></div>
    ${champ("validite_medical", "Fin de validité du certificat médical", e.validite_medical, "date")}
    ${champ("date_examen_theorique", "Examen théorique obtenu le", e.date_examen_theorique, "date")}
    ${champ("date_premier_solo", "Premier vol solo le", e.date_premier_solo, "date")}
    ${champ("date_test_vol", "Test en vol (date)", e.date_test_vol, "date")}
    <div class="large"><label for="f-notes">Notes</label><textarea id="f-notes" name="notes">${esc(e.notes)}</textarea></div>
  </div>`;
}

async function modaleEleve(e) {
  if (!e) {
    return ouvrirModale(`<h2>Nouvel élève</h2>${champsEleve(null)}`, { onSave: (d) => api("POST", "/eleves", d) });
  }
  const vols = await api("GET", `/eleves/${e.id}/vols`);
  ouvrirModale(`
    <h2>${esc(e.prenom)} ${esc(e.nom)}</h2>
    <div class="lecture mono">Total ${heures(e.heures_total)} · double ${heures(e.heures_double)} · solo ${heures(e.heures_solo)} · ${e.nb_vols} vol(s)</div>
    ${champsEleve(e)}
    <h3 style="margin-top:1.5rem">Carnet de vol</h3>
    <div style="margin-bottom:.8rem"><button type="button" class="btn secondaire petit" id="ajout-vol">+ Ajouter un vol</button></div>
    ${vols.length ? `<div class="defile"><table class="tableau"><thead><tr><th>Date</th><th>Durée</th><th>Type</th><th>Avion</th><th>Instructeur</th><th>Exercices</th><th></th></tr></thead><tbody>
      ${vols.map((v) => `<tr><td class="mono">${dateFr(v.date_vol)}</td><td class="mono">${heures(v.duree_minutes / 60)}</td>
        <td>${v.solo ? "Solo" : "Double"}</td><td class="mono">${esc(v.avion) || "—"}</td><td>${esc(v.instructeur) || "—"}</td>
        <td>${esc(v.exercices) || ""}${v.commentaire ? `<br><span class="aide">${esc(v.commentaire)}</span>` : ""}</td>
        <td><button type="button" class="btn danger petit" data-suppr-vol="${v.id}">×</button></td></tr>`).join("")}
      </tbody></table></div>` : `<div class="vide">Aucun vol enregistré.</div>`}`, {
    onSave: (d) => api("PATCH", "/eleves/" + e.id, d),
    onDelete: () => api("DELETE", "/eleves/" + e.id),
  });

  $("#ajout-vol", formModale).addEventListener("click", () => modaleVol(e));
  formModale.querySelectorAll("[data-suppr-vol]").forEach((b) => b.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    if (!confirm("Supprimer ce vol ?")) return;
    await api("DELETE", "/vols/" + b.dataset.supprVol);
    const maj = (await api("GET", "/eleves")).find((x) => x.id === e.id);
    modale.close();
    modaleEleve(maj);
  }));
}

function modaleVol(eleve) {
  modale.close();
  ouvrirModale(`
    <h2>Nouveau vol — ${esc(eleve.prenom)} ${esc(eleve.nom)}</h2>
    <input type="hidden" name="eleve_id" value="${eleve.id}">
    <div class="grille">
      ${champ("date_vol", "Date *", aujourdhui(), "date", "required")}
      ${champ("duree_minutes", "Durée (minutes) *", "", "number", 'required min="1" max="1440" inputmode="numeric"')}
      <div><label for="f-avion_id">Avion</label><select id="f-avion_id" name="avion_id">${options(ref.avions, null, nomAvion, "—")}</select></div>
      <div><label for="f-instructeur_id">Instructeur</label><select id="f-instructeur_id" name="instructeur_id">${options(ref.instructeurs, eleve.instructeur_id, nomInstructeur, "— Aucun —")}</select></div>
      <div class="large"><label class="case"><input type="checkbox" name="solo"> <span>Vol solo (sans instructeur à bord)</span></label></div>
      <div class="large">${champ("exercices", "Exercices travaillés", "", "text", 'placeholder="Ex. : tours de piste, décrochages, navigation"')}</div>
      <div class="large"><label for="f-commentaire">Commentaire de l'instructeur</label><textarea id="f-commentaire" name="commentaire"></textarea></div>
    </div>`, {
    onSave: async (d) => {
      await api("POST", "/vols", d);
      const maj = (await api("GET", "/eleves")).find((x) => x.id === eleve.id);
      setTimeout(() => modaleEleve(maj), 0);
    },
  });
}

// ---------- Instructeurs & avions ----------

async function vueEquipe() {
  const { instructeurs, avions } = ref;
  contenu.innerHTML = `
    <div class="entete-section"><h2>Instructeurs</h2><button class="btn" id="nouvel-instructeur">+ Instructeur</button></div>
    ${instructeurs.length ? `<div class="defile"><table class="tableau"><thead><tr><th>Nom</th><th>Téléphone</th><th>Email</th><th>Actif</th></tr></thead><tbody>
      ${instructeurs.map((i) => `<tr class="cliquable" data-instructeur="${i.id}"><td><strong>${esc(i.prenom)} ${esc(i.nom)}</strong></td>
        <td>${esc(i.telephone) || "—"}</td><td>${esc(i.email) || "—"}</td><td>${i.actif ? "Oui" : "Non"}</td></tr>`).join("")}
      </tbody></table></div>` : `<div class="vide">Aucun instructeur.</div>`}

    <div class="entete-section" style="margin-top:2.5rem"><h2>Avions</h2><button class="btn" id="nouvel-avion">+ Avion</button></div>
    ${avions.length ? `<div class="defile"><table class="tableau"><thead><tr><th>Immatriculation</th><th>Modèle</th><th>Places passagers</th><th>Actif</th></tr></thead><tbody>
      ${avions.map((a) => `<tr class="cliquable" data-avion="${a.id}"><td class="mono"><strong>${esc(a.immatriculation)}</strong></td>
        <td>${esc(a.modele)}</td><td class="mono">${a.places_passagers}</td><td>${a.actif ? "Oui" : "Non"}</td></tr>`).join("")}
      </tbody></table></div>` : `<div class="vide">Aucun avion.</div>`}`;

  $("#nouvel-instructeur").addEventListener("click", () => modaleInstructeur(null));
  $("#nouvel-avion").addEventListener("click", () => modaleAvion(null));
  contenu.querySelectorAll("[data-instructeur]").forEach((tr) => tr.addEventListener("click", () => modaleInstructeur(instructeurs.find((i) => i.id == tr.dataset.instructeur))));
  contenu.querySelectorAll("[data-avion]").forEach((tr) => tr.addEventListener("click", () => modaleAvion(avions.find((a) => a.id == tr.dataset.avion))));
}

function modaleInstructeur(i) {
  const v = i || { actif: 1 };
  ouvrirModale(`<h2>${i ? "Modifier l'instructeur" : "Nouvel instructeur"}</h2><div class="grille">
    ${champ("prenom", "Prénom *", v.prenom, "text", "required")}
    ${champ("nom", "Nom *", v.nom, "text", "required")}
    ${champ("telephone", "Téléphone", v.telephone, "tel")}
    ${champ("email", "Email", v.email, "email")}
    <div class="large"><label class="case"><input type="checkbox" name="actif" ${v.actif ? "checked" : ""}> <span>Actif (proposé dans les listes)</span></label></div>
  </div>`, {
    onSave: (d) => (i ? api("PATCH", "/instructeurs/" + i.id, d) : api("POST", "/instructeurs", d)),
    onDelete: i ? () => api("DELETE", "/instructeurs/" + i.id) : null,
  });
}

function modaleAvion(a) {
  const v = a || { actif: 1, places_passagers: 3 };
  ouvrirModale(`<h2>${a ? "Modifier l'avion" : "Nouvel avion"}</h2><div class="grille">
    ${champ("immatriculation", "Immatriculation *", v.immatriculation, "text", 'required placeholder="F-XXXX" style="text-transform:uppercase"')}
    ${champ("modele", "Modèle *", v.modele, "text", 'required placeholder="Ex. : Robin DR400"')}
    ${champ("places_passagers", "Places passagers", v.places_passagers, "number", 'min="1" max="9"')}
    <div><label>&nbsp;</label><label class="case"><input type="checkbox" name="actif" ${v.actif ? "checked" : ""}> <span>En service</span></label></div>
  </div>`, {
    onSave: (d) => (a ? api("PATCH", "/avions/" + a.id, d) : api("POST", "/avions", d)),
    onDelete: a ? () => api("DELETE", "/avions/" + a.id) : null,
  });
}

demarrer();
