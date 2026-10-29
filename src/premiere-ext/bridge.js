// Coffile dans Premiere (CEP) : Coffile dépose ses montages dans une « boîte d'envoi » ;
// ce pont les prend un par un, les fait construire par host.jsx et dépose le compte rendu.
// Il signale aussi qu'il est en vie (alive.json), pour que Coffile sache que Premiere est prêt.
(function () {
  var fs = require('fs');
  var path = require('path');
  var cep = window.__adobe_cep__;
  var log = [];

  function extDir() {
    var p = decodeURI(cep.getSystemPath('extension'));
    if (/^file:\/\/\/[A-Za-z]:/.test(p)) return p.replace('file:///', '');
    return p.replace(/^file:\/\//, '');
  }

  var EXT = extDir();
  var conf = {};
  try {
    conf = JSON.parse(fs.readFileSync(path.join(EXT, 'coffile.json'), 'utf8'));
  } catch (e) {}
  var DIR = conf.dir || '';
  var INBOX = path.join(DIR, 'inbox');
  var OUTBOX = path.join(DIR, 'outbox');
  var id = cep.getExtensionId ? cep.getExtensionId() : 'fr.coffile.premiere';
  var busy = false;

  function mkdirs() {
    try {
      fs.mkdirSync(INBOX, { recursive: true });
      fs.mkdirSync(OUTBOX, { recursive: true });
    } catch (e) {}
  }

  function evalScript(code) {
    return new Promise(function (resolve) {
      cep.evalScript(code, function (res) {
        resolve(res);
      });
    });
  }

  function show(msg, cls) {
    log.unshift({ t: new Date(), msg: msg, cls: cls || '' });
    log = log.slice(0, 30);
    var el = document.getElementById('log');
    if (!el) return;
    el.innerHTML = log
      .map(function (l) {
        return '<div class="' + l.cls + '"><i>' + l.t.toLocaleTimeString() + '</i>' + String(l.msg).replace(/[<&]/g, function (c) { return c === '<' ? '&lt;' : '&amp;'; }) + '</div>';
      })
      .join('');
  }

  function write(file, data) {
    var tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
  }

  // host.jsx est relu avant chaque montage (il peut avoir été mis à jour par Coffile).
  function loadHost() {
    var f = path.join(EXT, 'host.jsx').replace(/\\/g, '/');
    return evalScript('$.evalFile(new File("' + f.replace(/"/g, '\\"') + '"))');
  }

  function heartbeat() {
    if (!DIR) return;
    mkdirs();
    try {
      write(path.join(OUTBOX, 'alive.json'), { t: Date.now(), ext: id });
    } catch (e) {}
  }

  async function runJob(file) {
    var claimed = file + '.working';
    // Le premier qui renomme le fichier le prend (le panneau et le pont invisible tournent tous les deux).
    try {
      fs.renameSync(file, claimed);
    } catch (e) {
      return;
    }
    var job;
    try {
      job = JSON.parse(fs.readFileSync(claimed, 'utf8'));
    } catch (e) {
      fs.unlinkSync(claimed);
      return;
    }
    show('Montage reçu : ' + job.sequenceName);
    write(path.join(OUTBOX, job.id + '.state.json'), { state: 'working', t: Date.now() });
    await loadHost();
    var raw = await evalScript('COFFILE.run(' + JSON.stringify(job) + ')');
    var res;
    try {
      res = JSON.parse(raw);
    } catch (e) {
      res = { ok: false, error: 'Réponse de Premiere illisible : ' + String(raw).slice(0, 300) };
    }
    res.t = Date.now();
    write(path.join(OUTBOX, job.id + '.json'), res);
    fs.writeFileSync(path.join(OUTBOX, 'last-job.json'), JSON.stringify(job));
    try {
      fs.unlinkSync(claimed);
    } catch (e) {}
    if (res.ok) show('Séquence « ' + res.sequence + ' » créée (' + res.clips + ' clips' + (res.captions ? ', sous-titres' : '') + ')', 'ok');
    else show('Erreur : ' + res.error, 'err');
  }

  async function poll() {
    if (busy || !DIR) return;
    busy = true;
    try {
      var files = fs.readdirSync(INBOX).filter(function (f) {
        return /\.json$/.test(f);
      });
      files.sort();
      for (var i = 0; i < files.length; i++) await runJob(path.join(INBOX, files[i]));
    } catch (e) {}
    busy = false;
  }

  // Panneau : refaire le dernier montage (si Premiere n'était pas prêt, par exemple).
  window.coffileRetry = function () {
    try {
      var job = JSON.parse(fs.readFileSync(path.join(OUTBOX, 'last-job.json'), 'utf8'));
      write(path.join(INBOX, job.id + '.json'), job);
      show('Nouvel essai : ' + job.sequenceName);
    } catch (e) {
      show('Aucun montage à refaire.', 'err');
    }
  };

  mkdirs();
  evalScript('app.setExtensionPersistent("' + id + '", 1)');
  show(DIR ? 'Coffile est connecté. En attente d’un montage AUTOEDIT…' : 'Configuration de Coffile introuvable : rouvre Coffile.', DIR ? 'ok' : 'err');
  heartbeat();
  setInterval(heartbeat, 2000);
  setInterval(poll, 1500);
  poll();
})();
