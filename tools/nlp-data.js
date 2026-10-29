'use strict';
// Exemples d'entraînement du réseau de neurones de Coffile, générés à partir de modèles de
// phrases (beaucoup de tournures, abréviations, fautes de frappe, sans accents…).
// Étiquettes de phrase : tache, delai, envoi, retour, urgent, salut, info.
// Étiquette de message : montage.
const { rand } = require('../src/nlp/nn');

const pick = (list) => list[Math.floor(rand() * list.length)];
const maybe = (p, s) => (rand() < p ? s : '');
const fill = (tpl, slots) => tpl.replace(/\{(\w+)\}/g, (_, k) => (typeof slots[k] === 'function' ? slots[k]() : pick(slots[k])));

// ---------- Éléments ----------
const NAMES = ['Julie', 'Paul', 'Léa', 'Tom', 'Sarah', 'Hugo', 'Inès', 'Lucas', 'Camille', 'Marc', 'Nadia', 'Kevin', 'Emma', 'Yanis', 'Chloé', 'Mehdi', 'Laura', 'Antoine'];
const OBJ = [
  'la vidéo', 'cette vidéo', 'le reel', 'les reels', 'le teaser', 'le clip', 'le montage', 'les rushes', 'une version 9:16', 'une version 16:9', 'la V2', 'la V1', 'la VF',
  'le générique', 'le logo', 'les sous-titres', 'la musique', 'le son', "l'intro", 'la fin', 'les transitions', 'un short', 'la story', 'le spot', "l'interview", 'le best of',
  "l'aftermovie", 'une miniature', 'le titre', 'les plans drone', 'une version courte', 'la version longue', 'le format carré', 'le vlog', 'la pub', 'le making of',
  'la bande annonce', 'le portrait', 'le film', 'le motion', 'les cartons', "l'étalonnage", 'le mixage', 'un tiktok', 'le derush', 'le recap', 'la capsule', 'le récap de la soirée'
];
const VERB_INF = [
  'monter', 'faire', 'couper', 'ajouter', 'enlever', 'retirer', 'raccourcir', 'rallonger', 'changer', 'remplacer', 'mettre', 'intégrer', 'caler', 'synchroniser', 'étalonner',
  'mixer', 'exporter', 'sous-titrer', 'recadrer', 'accélérer', 'ralentir', 'stabiliser', 'nettoyer', 'dérusher', 'préparer', 'finaliser', 'corriger', 'refaire', 'reprendre',
  'retoucher', 'terminer', 'boucler', 'réaliser', 'créer', 'produire', 'découper', 'assembler', 'animer', 'virer', 'sortir', 'pondre', 'caler', 'checker', 'revoir',
  'retravailler', 'alléger', 'dynamiser', 'habiller', 'titrer', 'flouter', 'masquer', 'resserrer', 'dupliquer', 'décliner', 'adapter', 'reformater', 'compresser'
];
const VERB_IMP = [
  'monte', 'fais', 'coupe', 'ajoute', 'enlève', 'retire', 'raccourcis', 'rallonge', 'change', 'remplace', 'mets', 'intègre', 'cale', 'synchronise', 'étalonne', 'mixe',
  'exporte', 'recadre', 'accélère', 'ralentis', 'stabilise', 'prépare', 'finalise', 'corrige', 'refais', 'reprends', 'termine', 'boucle', 'découpe', 'rajoute',
  'vire', 'sors', 'cale', 'revois', 'retravaille', 'allège', 'dynamise', 'habille', 'floute', 'masque', 'resserre', 'décline', 'adapte', 'compresse'
];
const TASK_FRAMES = [
  '{ask} {vinf} {obj} ?', '{ask} {vinf} {obj}', '{must} {vinf} {obj}', '{must} que tu {vsub} {obj}', '{please} {vinf} {obj}', '{wish} {vinf} {obj}',
  '{vimp} {obj} {plz}', '{vimp}-moi {obj} {plz}', 'tu me {vpres} {obj} ?', 'tu nous {vpres} {obj} ?', 'on a besoin de {objn}', 'il me faut {objn}', 'il nous faudrait {objn}',
  'pense à {vinf} {obj}', "n'oublie pas de {vinf} {obj}", 'faudrait {vinf} {obj}', 'faut {vinf} {obj}', 'tu peux me {vinf} {obj} ?', 'est-ce que tu peux {vinf} {obj} ?',
  "est-ce que ce serait possible de {vinf} {obj} ?", 'ça serait top si tu pouvais {vinf} {obj}', "l'idée ce serait de {vinf} {obj}", 'à toi de {vinf} {obj}',
  'je te laisse {vinf} {obj}', 'tu peux t\'occuper de {objn} ?', 'tu pourras gérer {obj} ?', 'merci de bien vouloir {vinf} {obj}', 'il faudrait juste {vinf} {obj}',
  '{vimp} {obj} et {vimp2} {obj2}', '{ask} {vinf} {obj} pour {target} ?', 'tu me fais {obj} pour {target}', '{vimp} {obj} pour {target}', 'il faut {objn} pour {target}',
  'on a besoin de {objn} pour {target}', 'tu me fais une version carrée pour {target}', 'can you {en} the {enobj}?', 'please {en} the {enobj}', 'we need you to {en} the {enobj}'
];
const ASK = ['peux-tu', 'tu peux', 'pourrais-tu', 'tu pourrais', 'est-ce que tu peux', 'tu pourras', 'pourriez-vous', 'vous pouvez', 'pouvez-vous', 'est ce que tu pourrais', 'tu saurais'];
const MUST = ['il faut', 'il faudrait', 'il faudra', 'faudrait', 'faut', 'faudra', 'il va falloir', 'on doit', 'tu dois', 'tu devras'];
const PLEASE = ['merci de', "s'il te plaît", 'stp', 'svp', 'merci de bien'];
const WISH = ["j'aimerais", 'on aimerait', 'je voudrais', 'on voudrait', 'ce serait top de', 'ce serait bien de', "l'idée c'est de", "l'objectif est de", 'le but est de', 'je souhaiterais'];
const VSUB = ['montes', 'fasses', 'coupes', 'ajoutes', 'enlèves', 'retires', 'raccourcisses', 'changes', 'remplaces', 'mettes', 'intègres', 'exportes', 'termines', 'finalises'];
const VPRES = ['fais', 'montes', 'prépares', 'coupes', 'exportes', 'finalises', 'envoies'];
const OBJN = ['un reel', 'une vidéo de 30s', 'un teaser', 'une version courte', 'un montage de 1 min', 'trois reels', 'un short', 'un clip', 'une story', 'le montage', 'une pub de 15s'];
const EN = ['edit', 'cut', 'trim', 'export', 'finish', 'make'];
const ENOBJ = ['video', 'reel', 'teaser', 'footage', 'clip', 'intro', 'edit'];
const PLZ = ['', '', 'stp', 'svp', "s'il te plaît", 'merci', 'please', 'stp 🙏'];

const WHEN = [
  "aujourd'hui", 'ajd', 'ajdh', 'auj', 'aujourdhui', 'ce soir', 'demain', 'dmain', 'demain matin', 'demain soir', 'après-demain', 'vendredi', 'lundi', 'mardi', 'jeudi',
  'mercredi', 'lundi prochain', 'la semaine prochaine', 'semaine pro', 'fin de semaine', 'le 14', 'le 14/11', 'le 3 décembre', '14 novembre', 'dans 2 jours', 'dans 3 jours',
  'sous 48h', 'fin de journée', 'ce week-end', 'jeudi midi', 'mardi 18h', 'midi', '18h', 'la fin du mois', 'demain 10h', 'vendredi soir', 'cet aprem', 'avant le week-end',
  'dans la soirée', 'dans la journée', 'en fin de journée', 'avant ce soir', 'dans l\'après-midi', 'demain dans la matinée', 'le plus tôt possible', 'dans l\'heure'
];
// « pour insta », « pour le client » : pour qui / pour où, pas une date.
const TARGET = ['insta', 'instagram', 'youtube', 'tiktok', 'le client', 'la marque', 'leur site', 'linkedin', 'les réseaux', 'la pub tv', 'leur compte', 'le salon', 'la newsletter', 'facebook'];
const DL_FRAMES = [
  'pour {when}', 'avant {when}', "d'ici {when}", 'deadline {when}', 'deadline : {when}', 'délai : {when}', 'rendu {when}', 'livraison {when}', 'à rendre {when}',
  'à livrer {when}', '{when} max', 'livrable attendu {when}', 'livrable {when}', 'à remettre {when}', 'remise {when}', 'échéance {when}', 'on boucle {when}',
  'publication {when}', "c'est pour {when}", 'le client attend ça {when}', 'attendu {when}', 'prévu pour {when}', 'à caler pour {when}', 'il faut que ça parte {when}', '{when} au plus tard', 'au plus tard {when}', 'il me le faut pour {when}', "j'en ai besoin pour {when}", 'on doit l\'avoir pour {when}',
  'il faut que ce soit prêt pour {when}', 'faut que ce soit fini {when}', 'ça doit être prêt {when}', 'le client le veut pour {when}', 'il faut le poster {when}',
  'sortie prévue {when}', 'mise en ligne {when}', 'on publie {when}', 'le rendu c\'est {when}', 'la deadline c\'est {when}', 'la livraison est prévue {when}',
  'si possible pour {when}', 'idéalement pour {when}', 'dernier délai {when}', 'pour {when} sans faute', 'due {when}', 'by {when}'
];
const DL_TASK = [
  'pour {when} il faudra {vinf} {obj}', 'pour {when} il faudrait {vinf} {obj}', 'pour {when} faudra {vinf} {obj}', '{ask} {vinf} {obj} pour {when} ?', '{ask} {vinf} {obj} avant {when} ?',
  '{vimp} {obj} pour {when} {plz}', '{must} {vinf} {obj} pour {when}', "{must} {vinf} {obj} d'ici {when}", 'il me faut {objn} pour {when}', 'tu me fais {obj} pour {when} ?',
  '{when} il faut {vinf} {obj}', '{when} faudrait {vinf} {obj}', 'on a besoin de {objn} pour {when}', 'il faudra {vinf} {obj} {when}', 'pour {when} tu peux {vinf} {obj} ?'
];

// Envois avec une demande (« tu peux le transférer à… ») : envoi et tâche.
const SEND_ASK = [
  'tu peux le transférer à {name} ?', 'tu peux le faire suivre à {name} ?', 'tu pourras le faire parvenir à {name}', 'faudrait que ça parte chez {who} {when}',
  'il faut que ça parte chez {who}', 'mets la version finale dans le dossier {folder}', 'mets les exports dans {folder}', 'dépose les fichiers dans {folder}',
  'tu peux transmettre la V2 à {who} ?', 'pense à envoyer le lien à {who}', "n'oublie pas d'envoyer l'export à {name}", 'fais suivre à {who} stp', 'il faudra envoyer ça à {who}'
];
const WHO = ['le client', 'la prod', "l'agence", '{name}', 'la com', "toute l'équipe", 'la marque', 'Hélène de la com', 'notre contact', 'la réal'];
const FOLDER = ['LIVRABLES', 'EXPORTS', 'le dossier partagé', 'le drive du client', 'FINAL', 'le dossier de la prod'];
const SEND = [
  'envoie-le à {name}', 'envoie-la à {name}', 'envoie-les à {name}', 'tu me l\'envoies', 'tu me l\'envoies par {via}', 'envoie-moi ça {via2}', 'tu peux l\'envoyer à {name} ?',
  'transmets à {name}', 'partage-le {via2}', 'dépose-le {via2}', 'mets-le {via2}', 'upload sur {plat}', 'balance-le sur {plat}', 'envoie la V1 au client', 'envoie la version finale à la prod',
  'une fois fini envoie-le à {name}', 'quand c\'est fini tu me l\'envoies', 'tu peux me le partager {via2} ?', 'envoie à {mail}', 'mets {name} en copie', 'mets-moi en copie',
  'fais-le passer à {name}', 'tu me partages le lien', 'envoie le lien à {name}', 'send it to {name}', 'share it on {plat}', 'tu le déposes dans le dossier export', 'livre-le {via2}'
];
const VIA = ['wetransfer', 'mail', 'drive', 'frame.io', 'dropbox', 'whatsapp'];
const VIA2 = ['par wetransfer', 'par mail', 'sur le drive', 'sur frame.io', 'sur dropbox', 'dans le dossier partagé', 'sur whatsapp', 'en privé sur youtube'];
const PLAT = ['le drive', 'frame.io', 'youtube en privé', 'vimeo', 'le dossier partagé', 'dropbox'];
const MAILS = ['julie@agence.fr', 'prod@studio.com', 'contact@marque.fr', 'paul.martin@gmail.com'];

const TC = ['0:12', '00:45', '1:02', '0:03', '01:15', '00:00:12', '2:30', '0:58', '00:01:05', '3:12', '1min20', '1m20', '45s', "0'45", '2min', '1 min 10', '30 secondes', '12s', 'la 15e seconde'];
// Problèmes décrits sans verbe d'action (« le son sature », « on entend le vent »).
const PROBLEM = [
  'le son sature', 'on entend le vent dans le micro', 'il y a un saut d\'image', 'le son est décalé', 'c\'est désynchro', 'l\'image est floue', 'c\'est trop sombre',
  'on voit la perche', 'il y a un bip', 'la voix est trop basse', 'ça coupe net', 'il y a un écran noir', 'le texte déborde', 'la couleur change d\'un coup',
  'il y a une faute', 'le logo clignote', 'ça saccade', 'on entend une porte', 'le cadre penche', 'il y a un reflet'
];
const FIX = [
  'enlève le plan flou', 'coupe plus tôt', 'change la transition', 'baisse la musique', 'monte le son de la voix', 'le plan est trop long', 'le logo est mal placé', 'on voit le micro',
  'le titre arrive trop tôt', 'la couleur est trop jaune', 'mets un fondu', 'remplace par un plan drone', 'il y a une faute dans le sous-titre', 'le cut est trop sec',
  'ralentis un peu', 'le son grésille', 'recadre sur son visage', 'enlève le passage où il hésite', 'ajoute le carton', 'la musique coupe trop net'
];
const RETOUR = [
  '{tc} {fix}', 'à {tc} {fix}', 'vers {tc} {fix}', '{tc} : {fix}', '- {tc} {fix}', 'au niveau de {tc} {fix}', 'le plan à {tc} est flou', 'à {tc} on voit le micro',
  'petit retour : {fix}', 'retour client : {fix}', 'retours sur la V1 : {fix}', 'sur la V2, {fix}', 'la musique est trop forte', 'le début est trop long', 'la fin est un peu rapide',
  'les sous-titres sont trop petits', 'le logo est trop gros', 'le rythme est trop lent au milieu', 'l\'étalonnage est trop froid', 'le son est trop bas', 'j\'aime pas la transition à {tc}',
  'on pourrait couper la partie à {tc}', 'le passage à {tc} ne marche pas', '{tc} trop long', 'à {tc} {problem}', 'vers {tc} {problem}', '{tc} {problem}',
  '{problem} à {tc}', '{problem} vers {tc}', 'au début {problem}', 'à la fin {problem}', 'dans le 2e plan {problem}', 'sur le plan de {name} {problem}'
];
// Événements datés qui ne sont pas des dates limites.
const EVENTS = [
  'le tournage est prévu {when}', 'le tournage aura lieu {when}', 'on tourne {when}', 'le shooting est {when}', 'la réunion est {when}', 'on a un call {when}',
  'rendez-vous {when} au studio', 'le mariage a lieu {when}', 'le salon commence {when}', 'je suis en congé {when}', 'on se retrouve {when}', 'la soirée est {when}',
  'le tournage a été décalé à {when}', "l'interview est calée {when}", 'je passe au bureau {when}', 'le repérage se fait {when}', 'on filme {when}'
];

const URGENT = ["c'est urgent", 'urgent !', 'URGENT', 'asap', 'au plus vite', 'le plus vite possible', 'en urgence', "c'est pressé", 'dès que possible', 'priorité absolue',
  'ça presse', "c'est hyper urgent", 'rapidement stp', 'vite svp', 'il faut que ce soit fait rapidement', 'asap please', 'au plus vite merci', 'en priorité', 'urgentissime'];
const SALUT = ['salut', 'hello', 'coucou', 'bonjour {name}', 'hey', 'salut {name} !', "j'espère que tu vas bien", 'ça va ?', 'merci beaucoup', "merci d'avance", 'bonne journée',
  'à plus', 'bisous', 'cordialement', 'bien à toi', 'à bientôt', 'merci !', 'top merci', 'bonne soirée', 'yo', 'hello hello', 'bonjour à tous', 'merci pour ton aide',
  'belle journée', 'à demain', 'bises', 'merci encore', 'des bisous', 'bon courage', 'tiens-moi au courant', 'hésite pas si tu as des questions', 'bon week-end'];
const INFO = ['voici les rushes', 'le tournage s\'est bien passé', 'on a filmé à {city}', 'le client est content', 'les fichiers sont sur le drive', 'il y a 45 min de rushes',
  "c'est pour la marque", 'la caméra B a filmé les interviews', "je t'ai mis les photos", 'le drone a bien marché', 'on a 3 jours de tournage', 'la musique est dans le dossier',
  'ci-joint le brief', 'tu trouveras tout dans le lien', 'les rushes sont classés par jour', 'il y a deux caméras', 'le son est sur une piste séparée', 'voilà le lien des rushes',
  'je te mets les fichiers ici', 'les interviews sont dans le dossier B', "c'est tourné en 4K", 'on a fait 200 photos', 'la charte est dans le dossier', 'le brief est en pièce jointe',
  "c'est pour leur compte instagram", 'la cible ce sont les 18-25 ans', 'le ton doit être dynamique', 'on reste sur la même DA que la dernière fois'];
// Phrases qui annoncent un texte joint (transcription, script, voix off…) : ce qui suit est le texte,
// pas des choses à faire. Construites en morceaux pour couvrir beaucoup de tournures.
const JOIN = ['je te joins', 'je te mets', 'je te colle', "je t'envoie", 'voici', 'voilà', 'tu trouveras ci-dessous', 'en dessous tu as', "je t'ai mis", 'je te partage',
  'je te copie', 'je te donne', "je t'ajoute", 'je te file', "j'te mets", 'ci-dessous', 'ci-joint', 'je te transmets', 'je te laisse', "je t'envoie aussi", 'et voici', 'tiens',
  'je vous joins', 'vous trouverez ci-dessous', 'je vous mets', 'je te renvoie'];
const TEXTE = ['le texte', 'la transcription', 'la retranscription', 'le script', 'le verbatim', 'le texte de la voix off', "ce qu'elle dit", "ce qu'il dit", 'les paroles',
  "le texte de l'interview", 'le texte en anglais', 'les dialogues', "le texte qu'elle lit", 'la traduction', 'la trad', 'le texte du prompteur', 'le discours',
  'ce qui est dit dans la vidéo', 'le texte intégral', 'le texte de la vidéo', 'la transcription de la vidéo', "ce qu'elle raconte", 'le texte de la vo', 'le transcript',
  'ses réponses', 'les questions-réponses', 'le texte lu', 'le texte de {name}', "ce que dit {name}", 'le récap de ce qui est dit'];
const AUSSI = ['', '', 'aussi ', 'également ', 'en plus '];
const POUR = ['', '', 'pour ton dérush', "pour t'aider au dérush", 'pour le dérush', 'pour les sous-titres', "pour t'aider", "pour que tu saches ce qu'elle dit", 'pour caler les plans',
  'pour le montage', "si ça peut t'aider", 'pour te repérer', 'de la vidéo', "de l'interview", 'pour tes sous-titres', 'pour la vo', 'pour que tu suives'];
const FIN = ['', ' :', ':', ' ⬇️', ' 👇', ' ci-dessous', ' en dessous', ' ici :', ' juste en dessous :', ' :)', ' !'];
const ANNONCE_TURN = ['{texte} est ci-dessous', '{texte} est juste en dessous', 'pour le dérush, voici {texte}', '{texte} pour le dérush', 'en dessous {texte}',
  "je t'ai copié {texte} en dessous", "voilà {texte} si t'en as besoin", "{texte} si ça t'aide", 'pour les sous-titres voici {texte}', "j'ai retranscrit ce qu'elle dit"];
function annonce() {
  const texte = fill(pick(TEXTE), SLOTS);
  if (rand() < 0.25) return pick(ANNONCE_TURN).replace('{texte}', texte) + pick(FIN);
  return `${pick(JOIN)} ${pick(AUSSI)}${texte} ${pick(POUR)}`.trim() + pick(FIN);
}
// Ressemblent aux annonces, mais sont des demandes, des retours ou des infos.
const NOT_ANNONCE = [
  ['tu peux me faire la transcription', 'tache'], ["fais la transcription de l'interview", 'tache'], ['envoie-moi le texte', 'tache'], ['tu peux me renvoyer le script ?', 'tache'],
  ['ajoute le texte en sous-titres', 'tache'], ['mets le texte à l\'écran', 'tache'], ['il faut traduire le texte', 'tache'], ['tu pourras sous-titrer la vidéo', 'tache'],
  ['mets le texte en blanc', 'tache'], ['change la police du texte', 'tache'], ['mets le texte plus gros', 'tache'], ['centre le texte', 'tache'], ['mets les sous-titres en jaune', 'tache'],
  ['grossis le texte', 'tache'], ['mets le titre en gras', 'tache'], ['enlève le texte de la fin', 'tache'], ['mets le texte en haut', 'tache'], ['colle le texte sur le plan 2', 'tache'],
  ['mets la voix off plus fort', 'tache'], ['refais la voix off', 'tache'], ['le texte doit être centré', 'retour'], ['les paroles sont pas synchro', 'retour'],
  ['le texte à l\'écran est trop petit', 'retour'], ['il y a une faute dans le texte', 'retour'], ['le texte arrive trop tôt', 'retour'], ['la voix off est trop basse', 'retour'],
  ['je te joins les rushes', 'info'], ['voici le lien drive', 'info'], ["je t'envoie la musique", 'info'], ['je te mets les photos', 'info'], ['voilà les fichiers', 'info'],
  ['ci-joint le brief', 'info'], ['je te mets le logo en pièce jointe', 'info'], ['voici les rushes de la caméra B', 'info'], ["je t'envoie le lien wetransfer", 'info']
];

const CITY = ['Lyon', 'Paris', 'Marseille', 'Bordeaux', 'Lille', 'Nantes'];

// Phrases sans rapport (mails de la vie courante, notifications…) : aucune étiquette.
const OTHER = [
  'votre facture est disponible', 'votre colis est en route', 'votre mot de passe a été modifié', 'nouvelle connexion à votre compte', 'découvrez nos offres de la semaine',
  'votre abonnement expire bientôt', 'confirmez votre adresse e-mail', 'inscrivez-vous au webinar', 'vous avez un nouveau message', 'résumé de votre semaine', 'promotion -20% sur tout le site',
  'le match est à 20h', 'on mange où ce soir ?', 'je suis en vacances jusqu\'à lundi', 'la réunion est demain à 10h', 'le tournage aura lieu vendredi', 'on se voit jeudi pour en parler',
  'rendez-vous chez le dentiste mardi', 'ton paiement a bien été reçu', 'nouvelle vidéo sur notre chaîne youtube', 'regarde cette vidéo trop drôle', 'livraison gratuite dès 50€',
  'votre commande a été expédiée', 'joyeux anniversaire !', 'le concert est samedi soir', 'on a tourné hier toute la journée', 'la réunion de lundi est annulée',
  'les soldes commencent demain', 'votre relevé de compte est disponible', 'merci pour votre achat', 'votre rendez-vous est confirmé pour le 14/11', 'ton code de vérification est 482913',
  "l'apéro c'est vendredi", 'je serai absent demain', 'le bureau est fermé le 11 novembre', 'mise à jour de nos conditions générales', 'vous êtes invité à notre soirée',
  'le webinar commence dans 2 jours', 'votre essai gratuit se termine dans 3 jours', 'il pleut à Paris', 'mon train arrive à 18h', 'tu as vu le film hier ?',
  'ton colis sera livré demain', 'votre facture du mois d\'octobre', 'rappel : rendez-vous demain à 9h', 'la salle est réservée pour jeudi', 'on fête ça samedi',
  'le livre sort la semaine prochaine', 'les inscriptions ferment vendredi', 'promo valable jusqu\'à dimanche', 'dernier jour pour profiter de l\'offre'
];

// ---------- Augmentation : écrits « comme on écrit vraiment » ----------
const SHORT = [
  [/aujourd'hui/g, ['ajd', 'ajdh', 'auj', 'aujourdhui', 'aujd']],
  [/demain/g, ['dmain', '2main', 'demain']],
  [/s'il te plaît/g, ['stp', 'svp', 'stpp']],
  [/\bpour\b/g, ['pr', 'pour', 'pour']],
  [/\bdans\b/g, ['ds', 'dans']],
  [/vidéo/g, ['vid', 'video', 'vidéo']],
  [/\bquand\b/g, ['qd', 'quand']],
  [/il faudra/g, ['faudra', 'il faudra']],
  [/il faut/g, ['faut', 'il faut']],
  [/tu peux/g, ['tu peu', 'tu peut', 'tu peux']],
  [/est-ce que/g, ['est ce que', 'esque', 'est-ce que']],
  [/semaine prochaine/g, ['semaine pro', 'sem pro', 'semaine prochaine']],
  [/après-midi|aprem/g, ['aprem', 'aprèm', 'après-midi']],
  [/maintenant/g, ['mtn', 'maintenant']]
];
const deaccent = (s) => s.normalize('NFD').replace(/\p{M}/gu, '');

function typo(s) {
  const words = s.split(' ');
  const k = Math.floor(rand() * words.length);
  const w = words[k];
  if (w.length < 4) return s;
  const i = 1 + Math.floor(rand() * (w.length - 2));
  const r = rand();
  words[k] = r < 0.33 ? w.slice(0, i) + w.slice(i + 1) : r < 0.66 ? w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2) : w.slice(0, i) + w[i] + w.slice(i);
  return words.join(' ');
}

function augment(s) {
  let t = s;
  for (const [re, alts] of SHORT) if (rand() < 0.5) t = t.replace(re, () => pick(alts));
  if (rand() < 0.4) t = deaccent(t);
  if (rand() < 0.2) t = typo(t);
  if (rand() < 0.5) t = t.replace(/[.!?]+$/, '');
  if (rand() < 0.15) t += pick([' !!', ' 🙏', ' 😊', ' ?', ' merci', ' 👍']);
  if (rand() < 0.5) t = t.charAt(0).toUpperCase() + t.slice(1);
  if (rand() < 0.05) t = t.toUpperCase();
  return t.replace(/\s+/g, ' ').trim();
}

const SLOTS = {
  ask: ASK, must: MUST, please: PLEASE, wish: WISH, vinf: VERB_INF, vimp: VERB_IMP, vimp2: VERB_IMP, vsub: VSUB, vpres: VPRES, obj: OBJ, obj2: OBJ, objn: OBJN,
  en: EN, enobj: ENOBJ, plz: PLZ, when: WHEN, name: NAMES, via: VIA, via2: VIA2, plat: PLAT, mail: MAILS, tc: TC, fix: FIX, city: CITY,
  problem: PROBLEM, target: TARGET, who: () => fill(pick(WHO), { name: NAMES }), folder: FOLDER
};
const make = (frames) => augment(fill(pick(frames), SLOTS));

// ---------- Phrases étiquetées ----------
function sentence() {
  const r = rand();
  if (r < 0.2) return { text: make(TASK_FRAMES), y: { tache: 1 } };
  if (r < 0.32) return { text: make(DL_FRAMES), y: { delai: 1 } };
  if (r < 0.46) return { text: make(DL_TASK), y: { tache: 1, delai: 1 } };
  if (r < 0.52) return { text: make(SEND), y: { envoi: 1, tache: 0.5 } };
  if (r < 0.56) {
    const frame = pick(SEND_ASK);
    return { text: augment(fill(frame, SLOTS)), y: { envoi: 1, tache: 1, delai: frame.includes('{when}') ? 1 : 0 } };
  }
  if (r < 0.64) return { text: make(RETOUR), y: { retour: 1, tache: 0.5 } };
  if (r < 0.69) {
    const u = make(URGENT);
    return rand() < 0.4 ? { text: `${u} ${make(TASK_FRAMES)}`, y: { urgent: 1, tache: 1, delai: 1 } } : { text: u, y: { urgent: 1, delai: 1 } };
  }
  if (r < 0.77) return { text: make(SALUT), y: { salut: 1 } };
  if (r < 0.86) return { text: make(INFO), y: { info: 1 } };
  if (r < 0.9) return { text: make(EVENTS), y: {} };
  if (r < 0.94) return { text: augment(annonce()), y: { annonce: 1, info: 0.5 } };
  if (r < 0.96) {
    const [t, l] = pick(NOT_ANNONCE);
    return { text: augment(fill(t, SLOTS)), y: { [l]: 1 } };
  }
  return { text: augment(fill(pick(OTHER), SLOTS)), y: {} };
}

const LABELS = ['tache', 'delai', 'envoi', 'retour', 'urgent', 'salut', 'info', 'annonce'];
function sentenceData(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const s = sentence();
    const y = {};
    for (const l of LABELS) y[l] = s.y[l] != null ? s.y[l] : 0;
    out.push({ text: s.text, y });
  }
  return out;
}

// ---------- Messages complets : demande de montage ou non ----------
const SUBJ_POS = ['Rushes {obj}', 'Montage {obj}', 'Vidéo pour {name}', 'Reel {city}', 'V2 {obj}', 'Retours V1', 'Brief vidéo', 'Teaser', 'Fichiers tournage', 'Pour demain', 'Le lien', ''];
const SUBJ_NEG = ['Votre facture', 'Newsletter', 'Confirmation de commande', 'Invitation', 'Rappel', 'Promo', 'Votre compte', 'Re: apéro', 'Mise à jour', 'Bienvenue', ''];
const LINK = ['https://drive.google.com/drive/folders/1AbC', 'https://we.tl/t-xyz', 'https://www.dropbox.com/s/abc', '', '', ''];
const NEG_VIDEO = ['nouvelle vidéo sur notre chaîne : https://youtube.com/watch?v=x', 'regarde ce reel trop drôle', 'notre webinar sur le montage vidéo commence demain', 'découvrez notre formation premiere pro',
  'votre abonnement adobe premiere pro sera renouvelé', 'le tournage de la série commence lundi', 'merci pour votre inscription au festival du court métrage'];

// Textes joints (transcriptions inventées) : un montage peut contenir un long texte dans une autre langue.
const PASSAGES = [
  "Our new serum is made with natural ingredients. It hydrates your skin in depth and leaves it soft all day. Apply two drops every morning on a clean face.",
  "So I started the brand three years ago because I couldn't find products that worked for my skin. Today we have more than ten references and a lot of happy customers.",
  "Alors moi j'ai commencé la danse à six ans. Au début c'était juste pour m'amuser, et puis petit à petit c'est devenu toute ma vie. Aujourd'hui j'enseigne à Lyon.",
  "Bienvenue dans notre atelier. Ici chaque pièce est fabriquée à la main, avec du bois local. On prend le temps de bien faire les choses, c'est notre philosophie.",
  "This cream contains hyaluronic acid and vitamin C. Clinical tests show visible results after four weeks. It is suitable for all skin types, even sensitive skin.",
  "Hola a todos, hoy les presento nuestra nueva colección. Cada prenda está hecha con materiales reciclados y pensada para durar muchos años."
];
function message(positive) {
  const parts = [];
  if (rand() < 0.7) parts.push(augment(fill(pick(SALUT.slice(0, 12)), SLOTS)));
  if (positive) {
    if (rand() < 0.6) parts.push(make(INFO));
    const n = 1 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) {
      const r = rand();
      parts.push(r < 0.4 ? make(TASK_FRAMES) : r < 0.62 ? make(DL_TASK) : r < 0.72 ? make(SEND) : r < 0.8 ? make(SEND_ASK) : r < 0.92 ? make(RETOUR) : make(URGENT));
    }
    if (rand() < 0.5) parts.push(pick(LINK));
    if (rand() < 0.2) parts.push(`${augment(annonce())}\n${pick(PASSAGES)}`);
  } else {
    const n = 1 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) {
      const r = rand();
      parts.push(r < 0.2 ? augment(fill(pick(NEG_VIDEO), SLOTS)) : r < 0.45 ? make(EVENTS) : augment(fill(pick(OTHER), SLOTS)));
    }
    if (rand() < 0.15) parts.push(make(INFO).replace(/rushes?/g, 'photos'));
  }
  if (rand() < 0.6) parts.push(augment(fill(pick(SALUT.slice(8)), SLOTS)));
  const subject = augment(fill(pick(positive ? SUBJ_POS : SUBJ_NEG), SLOTS));
  return { text: `${subject}\n${parts.filter(Boolean).join(rand() < 0.5 ? '\n' : ' ')}`, y: { montage: positive ? 1 : 0 } };
}

function messageData(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(message(rand() < 0.5));
  return out;
}

module.exports = { sentenceData, messageData, LABELS, augment, annonce };
