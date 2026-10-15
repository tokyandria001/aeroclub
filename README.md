# Aéroclub — baptêmes de l'air et suivi des élèves PPL

Application web hébergée sur Cloudflare (plan gratuit) :

- **Page publique** (`/`) : formulaire de demande de baptême de l'air.
- **Espace club** (`/admin/`) : traitement des demandes de baptême, suivi des élèves PPL
  (étapes, carnet de vol, heures, validité du certificat médical), gestion des instructeurs et des avions.

## Architecture

| Élément | Où | Rôle |
|---|---|---|
| `public/` | Workers Static Assets | Pages HTML, CSS et JavaScript du navigateur |
| `src/index.js` | Cloudflare Worker | API JSON sous `/api/…` |
| Base `aeroclub` | Cloudflare D1 (SQLite) | Données ; schéma dans `migrations/0001_initial.sql` |

Aucune dépendance côté application : seul `wrangler` sert au déploiement.

## Mise en ligne

Le dépôt est relié à Cloudflare (Workers Builds) : chaque modification poussée sur `main` est déployée automatiquement.

L'espace club est protégé par un mot de passe stocké dans le **secret** `ADMIN_PASSWORD`
(tableau de bord Cloudflare → Workers → aeroclub → Settings → Variables and Secrets).
Tant qu'il n'est pas défini, l'espace club reste fermé.

## Développement local (facultatif)

```bash
npm install
npm run db:local                        # crée une base locale avec le schéma
echo 'ADMIN_PASSWORD=test' > .dev.vars  # mot de passe local
npm run dev                             # http://localhost:8787
```

## Données personnelles (RGPD)

- Le formulaire public demande un consentement explicite.
- Pour les élèves, seule la **date de validité** du certificat médical est conservée, jamais le document.
- Une demande de baptême ou un élève peut être supprimé définitivement depuis l'espace club.
