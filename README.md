# Coffile

Application Windows pour préparer un projet de montage en un clic.

Tu colles un lien Google Drive, tu donnes un nom au projet, et Coffile :

1. crée le dossier `<Dossier des projets>\<NOM DU PROJET>\` ;
2. télécharge tout le contenu du Drive (sous-dossiers compris) et le range :
   - **RUSHES** : les vidéos (et les fichiers audio du tournage)
   - **IMAGES** : les images (jpg, png, psd, raw, heic…)
   - **AUTRES** : les autres fichiers, seulement s'il y en a ;
3. crée **MONTAGE** avec `NOM DU PROJET.prproj` (copie de ton projet Premiere modèle) ;
4. crée **MUSIQUE**, **SOUND EFFECT** et **TEMPLATE**. Ils sont vides par défaut. Si tu les as liés à un dossier de ton PC, son contenu est copié dedans.

```
NOM DU PROJET/
├── RUSHES/
├── IMAGES/
├── MONTAGE/
│   └── NOM DU PROJET.prproj
├── MUSIQUE/
├── SOUND EFFECT/
└── TEMPLATE/
```

## Installation

Lance `Coffile-Setup-1.7.8.exe`. C'est un installateur Windows classique (NSIS) :

- il s'installe pour l'utilisateur courant, sans droits administrateur ;
- il crée un raccourci sur le Bureau et dans le menu Démarrer ;
- on le désinstalle depuis Paramètres › Applications.

> **À propos de l'avertissement Windows (SmartScreen)**
> L'application ne contient rien de suspect : pas de compression exotique, pas d'élévation de privilèges, et les métadonnées (nom, version, icône) sont renseignées.
> Comme l'installateur n'est **pas signé numériquement**, Windows peut quand même afficher « Windows a protégé votre ordinateur » au premier lancement. Clique sur **Informations complémentaires › Exécuter quand même**.
> Pour supprimer complètement cet avertissement, il faut signer l'exe avec un certificat de signature de code (par exemple Azure Trusted Signing, environ 10 €/mois, ou un certificat OV/EV). Le workflow `.github/workflows/build-windows.yml` signe automatiquement si tu ajoutes le certificat dans les secrets du dépôt.

## Premier lancement

1. Choisis le **dossier des projets** (par défaut `Vidéos\Coffile Projets`).
2. Choisis ton **projet Premiere modèle**. Ouvre Premiere Pro › Nouveau projet, nomme-le « Modèle », enregistre-le, puis sélectionne ce `.prproj` dans Coffile. Il sera dupliqué et renommé pour chaque projet, avec tes réglages.

> Pourquoi un modèle ? Le format `.prproj` est un format interne d'Adobe qui change à chaque version de Premiere. En partant de ton propre projet vide, le fichier s'ouvre toujours dans ta version, sans conversion.

## Ajouter à un projet existant

Tu peux mettre de nouveaux rushes dans un projet qui existe déjà, au lieu de créer un nouveau projet :

- Dans **Nouveau projet**, choisis **Ajouter à un projet** en haut du formulaire, puis le projet dans la liste (avec une recherche). Colle le lien Drive, puis **Ajouter au projet**.
- Dans la **Messagerie**, à côté de **Télécharger** (qui crée un nouveau projet, comme avant), le bouton **Ajouter à…** (l'icône dossier) ouvre la même liste. Pour un message avec plusieurs liens, il y a **Ajouter à un projet…**.
- Les vidéos et l'audio vont dans **RUSHES**, les images dans **IMAGES** (dans un sous-dossier par lien s'il y en a plusieurs). MONTAGE, MUSIQUE, SOUND EFFECT et TEMPLATE ne sont pas touchés.
- Un fichier déjà présent dans le projet (même nom, même taille) n'est pas retéléchargé.

## AUTOEDIT

### Onglet AUTOEDIT : un dossier de rushes de ton PC

Dans le menu, **AUTOEDIT** : glisse un dossier (ou **Choisir un dossier sur mon PC**). Coffile affiche ce qu'il contient : vidéos, images, sons, taille et les premiers rushes. Ensuite :
- **Nom du projet** : prérempli avec le nom du dossier.
- **Fichiers** : **Copier**, le dossier d'origine reste intact, ou **Déplacer**, sans doublon sur le disque.
- **Tout seul** :
  - proposer l'**ordre de tournage**, d'après la date des fichiers : les rushes arrivent déjà numérotés à l'étape **Classer** ;
  - mettre la **fin** trouvée (OUTRO, FIN, END CARD…) ;
  - **sous-titres automatiques**, avec le preset choisi.

**Lancer AUTOEDIT** crée le projet comme d'habitude : structure, modèle Premiere, bibliothèques. Les vidéos et sons vont dans RUSHES, les images dans IMAGES, le reste dans AUTRES, sous-dossiers gardés. AUTOEDIT s'ouvre ensuite sur l'étape **Classer**, avec l'ordre de tournage déjà proposé :
- clic gauche sur un rush : lecture sans les blancs ;
- clic droit : le rush entier ;
- flèches ▲ ▼ : changer sa place dans le montage.

Puis **Faire le bout à bout**, et **Valider** envoie le montage dans Premiere.

### Depuis un lien Drive ou un mail

La case **AUTOEDIT** est sous le formulaire **Nouveau projet** et sur chaque fiche de montage (Mail et Chat). Elle est **décochée par défaut**, à chaque projet. Si tu la coches, une fenêtre s'ouvre quand tout est téléchargé et rangé. Le bouton **AUTOEDIT** (fiche d'un projet dans Projets, ou fin de création) la rouvre là où tu l'avais laissée.

### 1. Classer les rushes

Toutes les vidéos de RUSHES sont listées. Les cartes réagissent ainsi :
- **Clic gauche** sur une carte : le rush se lit **sans les blancs** (les passages coupés sont sautés).
- **Clic droit** : le rush **entier**. Le sélecteur sous le lecteur passe aussi d'un mode à l'autre.
- Le **+** (ou **Classer et suivant**, touche Entrée) donne le numéro suivant : 1, 2, 3… Un clic sur le numéro le retire.
- Les flèches **▲ ▼** à côté du numéro changent la place d'un rush déjà classé.

Les rushes non classés ne sont pas utilisés. Pendant ce temps, Coffile lit le son de chaque rush pour repérer les blancs.

### 2. Bout à bout, overlays, fin et sous-titres

Coffile met les rushes dans ton ordre et **coupe les blancs** (pauses, silences en début et en fin), avec une marge autour de la parole. Les plans sans parole (ambiance, B-roll) et sans son restent entiers.
- **Aperçu et timeline** : lis le montage comme dans Premiere. La timeline montre chaque morceau avec la forme du son.
- **Onglet Coupe** : **Coupe** (douce ↔ forte) et **Pause minimale coupée** s'appliquent tout de suite. Un interrupteur par rush désactive la coupe.
- **Overlays** : un **double-clic** sur la vidéo ou la timeline ouvre **Ajouter un overlay**. Choisis le dossier (**IMAGES**, **RUSHES** ou **TEMPLATE**) : tout son contenu s'affiche, avec une recherche. Réglages :
  - **images** : durée à l'écran ;
  - **vidéos** : début dans la vidéo (**Instant affiché** prend l'image visible dans l'aperçu), durée, garder le son ou non ;
  - **modèles animés (.mogrt)** : Premiere les place lui-même, leur texte se règle ensuite dans Premiere ;
  - **Sound effect** : à cocher pour qu'un son démarre avec l'overlay (dossier SOUND EFFECT du projet ou ta bibliothèque).

  Un clic sur un overlay de la timeline permet de le modifier, de le déplacer (glisser) ou de le supprimer.
- **Ajouter une fin** : Coffile cherche dans **RUSHES, IMAGES et TEMPLATE** les fichiers nommés OUTRO, FIN, END, THE END, ENDING, END CARD, END SCREEN, ÉCRAN DE FIN, GÉNÉRIQUE, CRÉDITS, PACKSHOT, LOGO FIN… (ou rangés dans un dossier de ce nom). MERCI, THANK YOU, SUBSCRIBE, CTA sont proposés en dernier.
  - La plus probable est présélectionnée ; **Changer la fin** ou **Pas de fin** à tout moment.
  - Une vidéo de fin est gardée entière ; une image ou un .mogrt de fin a une durée réglable.
- **Onglet Sous-titres** : active **Sous-titres automatiques**.
  - Coffile écoute les rushes et écrit les sous-titres **sur ton PC** avec Whisper, fourni avec Coffile.
  - La première fois, il télécharge le modèle de langue : **Rapide** (60 Mo), **Précis** (190 Mo, conseillé) ou **Très précis** (540 Mo). Ensuite, plus besoin d'internet, de compte ni de crédit.
  - Chaque rush n'est transcrit qu'une fois : changer la coupe ne refait rien.
  - **Presets** : choisis-en un, ou **Régler** / **+** pour en créer. Tout se règle avec un aperçu en direct sur l'image du montage :
    - texte : police, taille, gras, italique, MAJUSCULES, sans ponctuation ;
    - couleurs : texte, contour et épaisseur, ombre, fond (couleur, opacité, arrondi) ;
    - position : haut, milieu ou bas, alignement, marge ;
    - découpage : lignes max, caractères par ligne, durée min et max, pause qui coupe.

    Coffile équilibre les lignes, coupe de préférence après une virgule et ne finit pas un sous-titre sur un petit mot (« le », « de », « on »…). Les presets sont gardés pour tous tes projets.
  - **Correction** : double-clic sur un sous-titre de la liste pour corriger son texte (Entrée pour valider).
  - **Dans Premiere**, deux choix :
    - **Piste de sous-titres Premiere** : vraie piste de sous-titres, texte modifiable dans Premiere. Le découpage vient du preset. Premiere ne laisse aucun autre logiciel régler la police et les couleurs de ses pistes de sous-titres : elles se règlent dans Premiere (Style de piste).
    - **Incrustés** : le style exact du preset, comme dans l'aperçu (une image transparente par sous-titre, sur V4).

### 3. Valider : le montage est construit dans Premiere

Premiere ne sait pas ouvrir un fichier de montage qu'on lui passe au lancement. Coffile installe donc une petite **extension Coffile dans Premiere**, qui démarre toute seule avec lui. À **Valider** :
1. Coffile écrit la séquence (`MONTAGE/<projet>_AUTOEDIT.xml`) et les sous-titres (`.srt`).
2. Coffile ouvre Premiere sur le projet du montage (le `.prproj` de MONTAGE, créé depuis ton modèle ; sinon l'extension en crée un).
3. L'extension importe la séquence dans un chutier **AUTOEDIT**, l'ouvre, place les .mogrt, crée la piste de sous-titres et enregistre le projet. Si l'import ne donne rien, elle reconstruit la séquence clip par clip.
4. Coffile affiche l'avancement en direct, puis **« Le montage est dans Premiere »** avec le nom de la séquence.

Pistes de la séquence :
- **V1** : rushes coupés puis la fin ;
- **V2** : overlays ;
- **V3** : .mogrt ;
- **V4** : sous-titres incrustés ;
- **A1-A2** : son des rushes ;
- **A3-A4** : sound effects ;
- **A5-A6** : son des overlays vidéo.

**La première fois** : l'extension est installée au démarrage de Coffile. Si Premiere était déjà ouvert, Coffile te demande de le **fermer et le rouvrir une fois** pour qu'elle se charge. Le panneau **Fenêtre › Extensions › Coffile** montre l'état et permet de **Refaire le dernier montage**. Si Premiere n'est pas trouvé, **Où est Premiere ?** permet de le choisir une fois pour toutes.

Les formats que l'aperçu ne lit pas (ProRes, DNxHD, MXF…) passent par une copie légère en 540p, faite une seule fois et utilisée seulement pour l'aperçu. Premiere reçoit toujours les fichiers d'origine. AUTOEDIT utilise **ffmpeg** et **Whisper**, fournis avec Coffile : rien à installer, tout reste sur ton PC.

## Le lien Google Drive

Coffile télécharge tout seul tous les médias du lien, même quand le Drive est **privé**.

### Comptes Google (Drive privés, 100 % automatique)

Dans Réglages › Comptes Google, clique sur **Connecter un compte Google**. Chrome s'ouvre, avec le profil choisi, sur le sélecteur de comptes Google. Tu choisis la session et tu acceptes.

- Coffile reçoit seulement un **accès en lecture seule** à Google Drive. Il ne voit jamais ton mot de passe.
- Le jeton est chiffré avec le coffre de Windows.
- Tu peux connecter **plusieurs comptes** (perso, agence, client…) et en définir un par défaut.
- Quand tu crées un projet, tu choisis le compte à utiliser. En mode **Automatique**, Coffile essaie chaque compte connecté, puis l'accès public.

**Configuration (une seule fois, environ 5 minutes)** : Google exige que chaque application ait son propre identifiant OAuth. Les 4 étapes sont détaillées dans l'app (Réglages › Comptes Google), avec des liens directs :

1. Crée un projet « Coffile » sur console.cloud.google.com.
2. Active l'API Google Drive.
3. Configure l'écran de consentement : public Externe, ajoute ton e-mail, puis clique sur **Publier l'application** pour que la connexion n'expire pas au bout de 7 jours. Comme l'app n'est pas vérifiée par Google, un écran « Google n'a pas validé cette application » s'affiche à la connexion. C'est normal pour une app perso : clique sur Paramètres avancés › Accéder à Coffile.
4. Crée un client OAuth de type **Application de bureau** et colle l'ID client et le code secret dans Coffile.

> Pour éviter cette étape sur d'autres PC, on peut intégrer l'identifiant à l'app : crée `src/oauth-client.json` contenant `{ "id": "…", "secret": "…" }` avant de compiler.

### Drive public

Si le dossier est partagé en « Tous les utilisateurs disposant du lien », Coffile le télécharge directement, sans compte.

### Dernier recours : via Chrome

Si aucun compte connecté n'a accès au Drive, Coffile ouvre le lien dans Chrome. Tu cliques sur « Télécharger ». Coffile récupère le `.zip` dans ton dossier Téléchargements, l'extrait et range tout. Tu peux désactiver ce comportement dans les Réglages.

Les fichiers Google Docs, Sheets et Slides sont ignorés.

## Messagerie (Mail et Chat)

L'onglet **Messagerie** a deux sous-onglets : **Mail** (Gmail) et **Chat** (Google Chat).

### Chrome de Coffile (par défaut, sans clé)

Coffile lance **son propre Chrome**, caché derrière l'app, et le pilote pour lire Gmail et Google Chat. Il n'y a **aucune clé ni configuration Google Cloud**.

1. La première fois, clique sur **Se connecter à Google** (dans Messagerie ou Réglages › Chrome de Coffile). Une fenêtre Chrome s'ouvre : connecte-toi normalement.
2. Dès que Gmail s'affiche, la fenêtre se cache et Coffile lit tes mails en arrière-plan. Tu peux **ajouter d'autres comptes** (perso, pro…) et choisir lequel afficher.
3. **Afficher la fenêtre Chrome** (dans Réglages) permet de voir ce que fait Coffile, ou de régler un souci de connexion.

> Pourquoi un Chrome séparé et pas ton Chrome habituel ? Depuis 2025, Chrome **interdit à un logiciel de piloter le profil principal**, pour bloquer les virus qui volent les sessions. Coffile utilise donc un profil « Coffile » à part. La connexion y est faite par toi, dans la vraie page Google, et Coffile ne voit jamais ton mot de passe.

**Mémoire et onglets** : le Chrome de Coffile garde au plus quelques onglets de travail (Gmail, Chat, Drive). Toutes les 30 secondes, il ferme les autres onglets. Après 4 minutes sans activité, il se **ferme tout seul** pour libérer la mémoire, et se relance en 2 ou 3 secondes quand il en a besoin. Il est aussi fermé quand tu quittes Coffile. Si Coffile a été fermé brutalement, son Chrome est récupéré et nettoyé au lancement suivant, au lieu d'en ouvrir un autre.

Cette même session sert aussi à **télécharger les Drive privés sans clé** : les comptes du Chrome de Coffile apparaissent dans le choix du compte d'un nouveau projet. En mode Automatique, Coffile essaie l'accès public, puis la session Chrome. Le contenu des dossiers est lu par Chrome lui-même. Si Google refuse le téléchargement direct, **Chrome télécharge le fichier** (page de confirmation des gros fichiers comprise), puis Coffile le range. Pour chaque lien, Coffile essaie d'abord le compte du mail, puis **tous les autres comptes connectés** : un lien peut avoir été partagé avec une autre adresse. Si un lien reste inaccessible, le message dit quel lien et pourquoi.

- **Gmail** : Coffile lit la boîte de réception (50 mails par page, comme Gmail) et le contenu de chaque mail, via la version imprimable de Gmail.
- **Google Chat** : lecture **expérimentale** de la page web Google Chat, qui change souvent. Si une conversation s'affiche mal, le bouton **Diagnostic** (en-tête de la conversation) enregistre dans Téléchargements la structure de la page, **sans le contenu des messages, sans noms ni adresses**, pour corriger la lecture. Le mode API reste possible.

### Pause café (le jeu du dino)

Tant que la Messagerie n'a pas **tout** chargé (la liste **et** le contenu des mails, ou les conversations), Coffile affiche en grand **son jeu du dino**, avec l'avancement au-dessus. **Afficher sans attendre** montre la liste tout de suite. Pendant la **création d'un projet** (téléchargement, rangement…), le jeu s'ouvre **en plein écran**, avec l'avancement du projet en haut. Il se ferme tout seul quand le projet est prêt. **Voir le détail** ou Échap pour revenir à l'écran de progression, et **Jouer en plein écran** pour y retourner. Le bouton **Jouer** en haut de la Messagerie l'ouvre quand tu veux.

- Un petit dino crème avec son café, au milieu de cactus, champignons, tulipes, tournesols et caféiers, dans des tons café, caramel et orange.
- **Espace** ou **↑** : sauter (un seul saut, appui court = petit saut), **↓** pour redescendre vite.
- 3 **cœurs**. À chaque coup, le jeu se fige un instant, l'écran tremble et le cœur perdu grossit au centre, se fissure et éclate. Un cœur rose permet parfois d'en regagner un.
- **5 grains de café** = **TURBO** pendant 5 s : le dino va plus vite et les points comptent double (grains à +20). Tu n'es **pas invincible** : un coup arrête le TURBO et coûte un cœur.
- Le **record** s'affiche en jaune avec une **couronne**. Si tu le bats pendant la partie, « NOUVEAU RECORD ! » s'affiche avec des confettis. Si tu meurs sans le battre, l'écran de fin te dit à combien de **%** de ton record tu étais.

### Montages détectés

Coffile repère les messages qui ressemblent à une demande de montage (lien Google Drive, rushes, reel, 9:16, deadline…).

- Ils sont mis en avant dans un bandeau en haut et surlignés dans la liste.
- **Dans Chat**, une demande écrite en plusieurs messages à la suite (les liens, puis « je te joins le texte… », puis le texte) est lue comme **une seule demande**, rattachée au message qui contient les liens. Les messages d'une même personne à moins de 20 minutes d'écart sont regroupés. Les autres messages du groupe affichent « Lu avec le message qui contient les liens ». Les liens propres à l'interface de Google (profils, avatars, Chat) ne sont plus pris pour des liens Drive.
- Chacun a une fiche avec toutes les infos : client, formats, durées, date limite, mots-clés et liens.
- **Télécharger** crée le projet avec le nom proposé (modifiable), télécharge le Drive avec le bon compte, puis fait toute la suite.
- Le badge de l'onglet compte les montages pas encore lancés. Il est vérifié toutes les 5 minutes.
- Devant chaque lien, Coffile affiche entre « » le texte écrit juste avant dans le mail ou le message (par exemple « Rushes caméra A »).
- **Plusieurs liens Drive** : chaque lien a une case à cocher et un champ **Dossier**, prérempli avec ce texte. **Télécharger les N liens dans un projet** crée un seul projet. Les vidéos de chaque lien vont dans `RUSHES/<nom du dossier>` et les images dans `IMAGES/<nom du dossier>`. Si un lien contient les deux, Coffile trie tout seul.
- **Voir**, **Plein écran** ou un **double-clic** sur un mail ou un message Chat ouvre la fiche en grand dans Coffile : infos, liens, téléchargement et message complet. **Retour** ou Échap pour revenir.

### Filtre des expéditeurs

Le bouton **Filtre** (à côté de Tout / Montages) s'active d'un clic et ouvre sa fenêtre :

- La fenêtre liste les **expéditeurs** qui t'ont écrit, par mail ou dans Chat, avec leur nombre de messages et de montages. Une **recherche** permet de trouver un nom ou une adresse.
- Coche les adresses voulues. Quand le filtre est activé, **seuls leurs messages peuvent compter comme montages**. Les autres messages restent visibles, mais ne sont plus mis en avant.
- **Cocher ceux qui envoient des montages** sélectionne en un clic les expéditeurs qui t'ont déjà envoyé des demandes.
- L'interrupteur en haut **désactive le filtre** à tout moment, sans perdre ta sélection.

### Ce que Coffile comprend d'un mail

Coffile lit **seulement le texte des messages** : pas le titre de la page Gmail, ni ton nom et ton adresse, ni les lignes « De / À ». Dans un fil, tes propres réponses sont laissées de côté quand d'autres personnes ont écrit. Les longs liens que Gmail coupe sont recollés.

Pour chaque message, Coffile affiche un panneau **« Ce que Coffile a compris »** (dans la fiche en grand et dans le mail) :

- **En bref** : les premières phrases utiles.
- **À faire** : les demandes (« peux-tu… », « il faudrait… », listes à puces).
- **Retours avec timecodes** : « 0:12 enlève le plan flou ».
- **Envoyer à** : les personnes, les adresses, les personnes en copie et le moyen d'envoi (WeTransfer, Drive…).
- **Personnes citées**, **Logiciels** (Premiere Pro, After Effects, DaVinci…) et **Points clés** (sous-titres, voix off, étalonnage…).
- **Musique**, **Références** (Instagram, YouTube, TikTok…), **Budget** et **Téléphone** (un clic copie le numéro).
- **Transcription** ou texte de voix off, à afficher et à copier en un clic. Coffile la repère grâce à la **phrase qui l'annonce** (« Je te joins le texte aussi pour ton dérush : », « en dessous t'as ce qu'elle dit dans la vidéo », « voilà le script »…), quelle que soit la langue du texte. Tout ce qui suit cette phrase est le texte joint : il n'est **pas lu comme des choses à faire**, ni comme des personnes ou des dates. Une consigne sur le texte (« mets le texte en blanc », « tu peux me faire la transcription ? ») reste une tâche.

**Dates limites comprises** : « pour ajdh », « dmain matin », « d'ici 2 jours », « sous 48h », « vendredi 18h », « semaine pro », « le 14/11 », « asap »… deviennent une vraie date. Elle est calculée à partir de la **date du message** : un « demain » écrit hier, c'est aujourd'hui. L'affichage s'adapte au jour où tu regardes : Aujourd'hui, Demain matin, Vendredi 30 oct., ou En retard en rouge. « Pas pressé » ou « quand tu peux » ne comptent pas comme urgents. Les événements (« le tournage est vendredi », « réunion jeudi ») ne sont pas pris pour des dates limites.

**Réseau de neurones intégré (hors ligne)** : Coffile contient un petit réseau de neurones, entraîné pour l'app, qui tourne sur ton PC sans connexion ni crédit. Il lit chaque phrase, y compris avec des fautes, des abréviations ou des tournures inhabituelles (« tu peux virer le passage où il bafouille », « tu le balances sur le drive », « à 1min20 le son sature »). Il repère : à faire, date limite, envoi, retour, urgence, salutation, info, et l'annonce d'un texte joint (transcription, script, voix off). Un 2e réseau estime si le message entier est une demande de montage. Les règles et le réseau se complètent.
- Entraînement : `node tools/train-nlp.js` (exemples générés à partir de modèles de phrases, avec abréviations, fautes et sans accents). Mesure honnête sur des phrases écrites à la main et jamais vues : `node tools/nlp-eval.js`.
- Le réseau « message » **continue d'apprendre sur ton PC** à chaque projet créé et à chaque « Pas un montage » / « C'est un montage ». Sa version personnelle est enregistrée dans le dossier de l'app, et « Oublier » (fenêtre du Filtre) la remet à zéro.

Coffile **apprend de tes choix**, sur ton PC uniquement. Chaque projet créé depuis un message lui apprend « c'est un montage ». Le bouton **Pas un montage** (le pouce vers le bas) retire un message des montages et lui apprend le contraire. **C'est un montage** ajoute un message oublié. Avec le temps, Coffile repère mieux tes demandes, même sans lien, et écarte ce que tu refuses. Le pourcentage « Appris » s'affiche dans le panneau, et la fenêtre du Filtre permet de tout oublier.

### Mode API Google (optionnel)

Dans Réglages › Chrome de Coffile › **Messagerie via l'API Google**, Coffile utilise les API officielles Gmail et Google Chat avec les comptes de « Comptes Google (API) ». Ce mode demande la configuration Google Cloud décrite plus haut. Google Chat par API est réservé aux comptes **Google Workspace**.

## Notes

L'onglet **Notes** sert à écrire des notes, sur plusieurs **feuilles**. Chaque feuille est **un fichier texte** (.txt) dans `Documents/Coffile Notes`. **Dossier** l'ouvre dans l'Explorateur, et la roue dentée permet de choisir un autre dossier. Tout est **enregistré tout seul** pendant que tu écris.

- **Nouvelle feuille** crée un nouveau fichier. Le nom en haut de la feuille renomme le fichier, et la corbeille le met dans la corbeille de Windows.
- Mise en forme : **gras** (Ctrl+B), **MAJUSCULES** (Ctrl+Maj+U, un 2e clic remet en minuscules), **Titre** (Ctrl+1), **Sous-titre** (Ctrl+2), **Texte** normal (Ctrl+0), **couleur du texte** (pastilles ou couleur au choix), et la gomme pour enlever gras et couleur.
- **Codes couleur** : écris un code comme `A7998B` ou `#A7998B` et il s'affiche **dans sa couleur**. Un **clic** le copie (sans le « # », prêt à coller dans Premiere Pro) et affiche « Couleur copiée ». Un code sans chiffre n'est reconnu qu'avec un « # » ou s'il est fait de paires (`FFFFFF`, `FFAACC`), pour que des mots comme FACADE restent du texte.
- **Commandes « / »** : tape `/` dans la note. La liste s'affiche et se filtre pendant que tu écris, Entrée valide. Les mêmes commandes sont affichées en haut de la note.
  - `/projet` : choisis un de tes projets Premiere Pro, avec une recherche. Un lien est ajouté dans la note, et un clic ouvre le projet.
  - `/export` : lie une vidéo exportée de tes projets, avec la même recherche.
  - `/file` et `/folder` : lient un fichier ou un dossier du PC.
  - `/image` : ajoute une image. Elle est copiée dans `Coffile Notes/images`, pour rester dans la note même si l'original bouge.
  - `/emoji` : choisis un emoji, avec une recherche en français (café, ok, feu…) et tes derniers emojis.
  - `/titre` et `/soustitre` : mettent la ligne en titre ou en sous-titre.
- **Clic droit** dans la note : le menu des commandes, qui insère à l'endroit du clic.
- Un clic sur un lien l'ouvre, Ctrl+clic l'affiche dans l'Explorateur. Un lien vers un fichier qui n'existe plus est barré.
- **Taille du texte** : A− / A+ dans la barre d'outils.
- **Plein écran** : l'app n'affiche plus que la note. Échap pour revenir.
- Le fichier reste lisible dans le Bloc-notes : `# Titre`, `## Sous-titre`, `**gras**`, `{#E8772E}texte en couleur{/}`.

## Exports

L'onglet **Exports** liste tous les rendus vidéo de tous tes projets. Coffile considère comme un export :

- une vidéo rangée dans un dossier EXPORT, RENDU, RENDER, LIVRABLE, OUTPUT, FINAL… ;
- une vidéo dont le nom contient une version (`V1`, `v2`, `V3.1`, `version2`, `VF`, `FINAL`…). Une sous-version s'écrit **avec un point** (`v1.9`). `V1_9x16` est donc lu comme la **V1** au format **9:16** ;
- une vidéo posée dans MONTAGE ou à la racine du projet.

Les dossiers RUSHES, proxys, prévisualisations et sauvegardes automatiques de Premiere sont ignorés.

Pour chaque export, Coffile lit directement dans le fichier :

- la résolution et le ratio (16:9, 9:16, 1:1, 4:5…) ;
- la durée ;
- le codec (H.264, H.265, ProRes…) pour les MP4 et MOV.

Tu peux regrouper les exports :

- **par version** : les V1, V2, VF d'un même montage sont regroupés, avec la plus récente marquée « Dernière » ;
- **par format** ;
- **par projet**.

Tu peux aussi filtrer par ratio ou par type de fichier, et faire une recherche.

Par défaut, les exports s'affichent en **grille de vidéos** : survole une vidéo pour la lire. Le bouton à côté passe en **liste** détaillée.

**Double-clic** sur un export (ou Entrée) : il s'affiche dans l'Explorateur.

### Auto rename

Le bouton **Auto rename** (en haut de l'onglet Exports, sur chaque projet en vue « Par projet », ou dans le détail d'un projet) renomme tous les exports d'un projet au format :

```
titre_version_format_date.ext      ex. SpotNike_V2_16x9_010126.mp4
```

- **titre** : celui que tu saisis. Il est mémorisé pour le projet.
- **version** : reprise **telle qu'elle est écrite** dans le nom actuel (`V1`, `v1.9`, `V2_FINAL`, `VF`…). Elle doit déjà être dans le nom. Sinon, l'export est ignoré, sauf si tu tapes la version dans l'aperçu.
- **format** : le ratio réel de la vidéo (`16x9`, `9x16`, `1x1`, `4x5`…).
- **date** : la date de création de l'export, au format JJMMAA (`010126` = 1er janvier 2026).

Avant de valider, un aperçu montre l'ancien et le nouveau nom de chaque fichier. Les noms en double reçoivent un suffixe (`_2`) et aucun fichier n'est jamais écrasé. Le bouton **Annuler le renommage** remet les anciens noms.

## Projets

L'onglet Projets affiche **tous les dossiers** présents dans ton dossier des projets, y compris ceux qui existaient avant Coffile.

- **Image de couverture** : la **dernière version exportée**. Survole-la avec la souris pour **lire la vidéo** (sans le son). S'il n'y a pas encore d'export, l'image vient d'un rush, sinon d'une image du dossier IMAGES.
- **Icône et couleur** : chaque projet a les siennes. Coffile en devine une d'après le nom (mariage → cœur, vlog → avion, interview → micro…). Clique sur l'icône pour la changer, ou choisis-la dès la création du projet.
- **Épingler** : le bouton 📌 sur la couverture place le projet en haut de la liste et dans la barre latérale.
- **Pour chaque projet**, tu vois aussi le nombre de vidéos, d'images et de fichiers audio, la taille totale, la date de modification et les projets Premiere trouvés.
- **Détail du projet** (clic sur la carte) : grande couverture lisible au survol, taille de chaque sous-dossier, fichiers `.prproj`, exports avec miniatures et lien Drive d'origine.

Les miniatures sont créées une seule fois, puis gardées en cache. L'aperçu au survol fonctionne pour les MP4, MOV et WebM que Windows sait lire (H.264, et H.265 sur la plupart des PC récents). Les ProRes et les fichiers RAW (R3D, BRAW) n'ont pas d'aperçu.

## Mises à jour automatiques

Coffile cherche une nouvelle version **à chaque lancement**, puis toutes les heures, et la télécharge en arrière-plan. Une fois téléchargée, il l'**installe tout seul**. La mise à jour est **obligatoire** : un compte à rebours de 15 s couvre tout l'écran (on peut seulement redémarrer tout de suite), puis Coffile se ferme, s'installe sans fenêtre et se relance sur la nouvelle version. Si Coffile est occupé (projet en cours de création, AUTOEDIT ouvert), il attend la fin pour ne rien perdre, puis installe. Fermer Coffile avant l'installe aussi.

Les versions sont publiées dans les **Releases GitHub** du dépôt `kimany91/Coffile`. Ce dépôt doit être **public** : sinon, les PC ne peuvent pas lire les mises à jour.

Pour publier une nouvelle version, il suffit de changer `"version"` dans `package.json` (ex. 1.7.9) et de l'envoyer sur `main`. Le workflow `.github/workflows/build-windows.yml` le voit, compile l'installateur sur Windows (ffmpeg et whisper sont téléchargés depuis leurs versions officielles et vérifiés), puis publie la release `v1.7.9` (`Coffile-Setup-x.y.z.exe`, `.blockmap` et `latest.yml`). Une version déjà publiée n'est jamais refaite. Ensuite, tous les Coffile installés se mettent à jour tout seuls.

Sans GitHub Actions, la même chose se fait depuis un PC avec un jeton GitHub : `GH_TOKEN=… npm run release`.

## Développement

```bash
npm install
npm start          # lance l'app
npm run dist       # génère dist/Coffile-Setup-<version>.exe
```

Pour compiler sous Linux ou macOS, il faut Wine (32 et 64 bits). Le plus simple reste le workflow GitHub Actions fourni, qui compile sur Windows.

Structure :

- `src/main.js` : fenêtre, réglages, IPC
- `src/updater.js` : mises à jour automatiques (electron-updater + GitHub Releases)
- `src/google.js` : comptes Google (OAuth dans Chrome, jetons chiffrés)
- `src/browser.js` : profils Chrome, import via Chrome (surveillance des Téléchargements, extraction des zip)
- `src/media.js` : exports (détection, versions, lecture résolution/durée/codec des MP4/MOV)
- `src/library.js` : analyse des dossiers de projets (couverture, dernière version exportée)
- `src/chrome.js` : Chrome piloté par Coffile (profil séparé, fenêtre cachée, connexion, cookies de session)
- `src/chrome-inbox.js` : lecture de Gmail et Google Chat dans ce Chrome
- `src/inbox.js` : lecture Gmail et Google Chat par les API officielles (mode API)
- `src/detect.js` : détection des demandes de montage dans les messages (liens, formats, durées, deadline, nom proposé)
- `src/rename.js` : Auto rename des exports (renommage groupé sans écrasement)
- `src/mediaserver.js` : lecture des vidéos et images locales dans l'app, cache des miniatures
- `src/drive.js` : lecture des liens, listing et téléchargement Google Drive
- `src/project.js` : création du projet (dossiers, téléchargements, copies, Premiere)
- `src/renderer/` : interface (HTML/CSS/JS, police Inter incluse)
