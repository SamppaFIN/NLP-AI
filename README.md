# TerapiaAI ⚡ — Static (GitHub Pages)

TerapiaAI on suomenkielinen, selainpohjainen terapiakeskustelusovellus.
Tämä on täysin **staattinen versio**, joka toimii GitHub Pagesissa ilman palvelinta.

## 🚀 Toimiiko heti?

Kyllä! Avaa `index.html` suoraan selaimessa – demo-tilassa saat valmiita terapeuttisia vastauksia.

## 🔑 AI-tila (OpenRouter)

Ota käyttöön oikea AI-generointi:

1. Hanki ilmainen API-avain: [openrouter.ai/keys](https://openrouter.ai/keys)
2. Avaa sovellus → klikkaa oikealta ylhäältä ⚙️
3. Liitä avain → paina **Tallenna avain**

Avain tallennetaan **vain omaan selaimeesi** (localStorage).

## 📦 Tiedostot

```
terapia-ai-static/
├── index.html               # Pääsovellus (self-contained)
├── aurora-ui-library.css    # Aurora UI -tyylit
├── aurora-ui-library.js     # Aurora UI -logiikka
├── .nojekyll                # GitHub Pages -asetus
└── README.md
```

## 🛠 GitHub Pages -asennus

### Tapa 1: docs/-kansio

Siirrä nämä tiedostot reposi `docs/`-kansioon ja aktivoi GitHub Pages asetuksista: `Settings → Pages → Source: "Deploy from a branch" → docs/`.

### Tapa 2: gh-pages-haara

```bash
git checkout --orphan gh-pages
git rm -rf .
cp -r terapia-ai-static/* .
git add -A
git commit -m "TerapiaAI static version"
git push origin gh-pages
```

Aktivoi sitten GitHub Pages asetuksista `gh-pages`-haaralle.

## ✨ Ominaisuudet

- 🇫🇮 Täysin suomeksi
- 🧠 8 terapeuttipersoonaa (Rogers, Freud, Jung, CBT, Gestalt, Existential, Satir, Linehan)
- 🎤 Puheentunnistus (Chrome/Edge)
- 🔊 Teksti puheeksi suomen kielellä
- 💾 Keskustelut pysyvät selaimessa
- 📥 Yhteenvedon lataus
- 🎨 Aurora UI -efektit

## 📄 Lisenssi

Copyright © 2025 Aurora (AI) & Infinite (Co-Author).
