// Coffile dans Premiere (ExtendScript) : construit le montage AUTOEDIT dans le projet.
// 1) ouvre (ou crée) le projet du montage ; 2) importe la séquence XML dans un chutier
// « AUTOEDIT » ; si l'import ne donne rien, reconstruit la séquence clip par clip avec l'API ;
// 3) ouvre la séquence, place les modèles d'animation (.mogrt), crée la piste de sous-titres
// à partir du .srt ; 4) enregistre. Renvoie un compte rendu (texte JSON) à Coffile.
// Écrit pour l'ExtendScript de Premiere (JavaScript ancien : var, pas de JSON intégré).

var COFFILE = (function () {
  var TICKS = 254016000000;

  function str(s) {
    return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t') + '"';
  }

  function json(v) {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'number') return isFinite(v) ? String(v) : 'null';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'string') return str(v);
    if (v instanceof Array) {
      var a = [];
      for (var i = 0; i < v.length; i++) a.push(json(v[i]));
      return '[' + a.join(',') + ']';
    }
    var o = [];
    for (var k in v) if (v.hasOwnProperty(k)) o.push(str(k) + ':' + json(v[k]));
    return '{' + o.join(',') + '}';
  }

  function norm(p) {
    return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  }

  function ticks(sec) {
    return String(Math.round(sec * TICKS));
  }

  function timeOf(sec) {
    var t = new Time();
    t.seconds = sec;
    return t;
  }

  // Projet du montage : celui qui est ouvert, sinon on l'ouvre (ou on le crée).
  function projectFor(job) {
    var want = norm(job.projectPath);
    var i;
    if (want) {
      for (i = 0; i < app.projects.numProjects; i++) if (norm(app.projects[i].path) === want) return app.projects[i];
      var f = new File(job.projectPath);
      if (f.exists) app.openDocument(job.projectPath, true, true, true);
      else app.newProject(job.projectPath);
      for (i = 0; i < app.projects.numProjects; i++) if (norm(app.projects[i].path) === want) return app.projects[i];
    }
    if (app.project && app.project.rootItem) return app.project;
    throw new Error("Aucun projet ouvert dans Premiere");
  }

  function binNamed(parent, name) {
    for (var i = 0; i < parent.children.numItems; i++) {
      var c = parent.children[i];
      if (c && c.type === ProjectItemType.BIN && c.name === name) return c;
    }
    var made = parent.createBin(name);
    if (made) return made;
    for (i = 0; i < parent.children.numItems; i++) if (parent.children[i].type === ProjectItemType.BIN && parent.children[i].name === name) return parent.children[i];
    return parent;
  }

  // Élément du projet qui pointe sur ce fichier (cherché dans tout le projet).
  function itemFor(root, filePath) {
    var want = norm(filePath);
    var stack = [root];
    while (stack.length) {
      var it = stack.pop();
      for (var i = 0; i < it.children.numItems; i++) {
        var c = it.children[i];
        if (!c) continue;
        if (c.type === ProjectItemType.BIN) stack.push(c);
        else {
          var mp = '';
          try {
            mp = c.getMediaPath();
          } catch (e) {}
          if (mp && norm(mp) === want) return c;
        }
      }
    }
    return null;
  }

  function importAll(proj, bin, paths) {
    var missing = [];
    for (var i = 0; i < paths.length; i++) if (!itemFor(proj.rootItem, paths[i])) missing.push(paths[i]);
    if (missing.length) proj.importFiles(missing, true, bin, false);
  }

  function sequenceIds(proj) {
    var ids = {};
    for (var i = 0; i < proj.sequences.numSequences; i++) ids[proj.sequences[i].sequenceID] = true;
    return ids;
  }

  function newSequence(proj, before, name) {
    var found = null;
    for (var i = 0; i < proj.sequences.numSequences; i++) {
      var s = proj.sequences[i];
      if (before[s.sequenceID]) continue;
      if (!found || s.name === name) found = s;
    }
    return found;
  }

  function clipCount(seq) {
    var n = 0;
    for (var i = 0; i < seq.videoTracks.numTracks; i++) n += seq.videoTracks[i].clips.numItems;
    return n;
  }

  // Dernier clip posé sur une piste à cet instant (pour régler sa fin ou sa taille).
  function clipAt(track, sec) {
    var best = null;
    for (var i = 0; i < track.clips.numItems; i++) {
      var c = track.clips[i];
      if (Math.abs(c.start.seconds - sec) < 0.02) best = c;
    }
    return best;
  }

  // Taille de l'image dans le cadre (effet Trajectoire / Motion, paramètre « Échelle »).
  function setScale(clip, scale) {
    if (!clip || !scale || Math.abs(scale - 100) < 0.01) return;
    for (var i = 0; i < clip.components.numItems; i++) {
      var comp = clip.components[i];
      if (comp.matchName === 'AE.ADBE Motion' || comp.displayName === 'Motion' || comp.displayName === 'Trajectoire') {
        try {
          comp.properties[1].setValue(scale, true);
        } catch (e) {}
        return;
      }
    }
  }

  function place(track, item, at, inSec, outSec, still) {
    if (still) {
      track.overwriteClip(item, ticks(at));
      var c = clipAt(track, at);
      if (c && outSec > 0) c.end = timeOf(at + outSec);
      return c;
    }
    item.setInPoint(inSec, 4);
    item.setOutPoint(outSec, 4);
    track.overwriteClip(item, ticks(at));
    try {
      item.clearInPoint();
      item.clearOutPoint();
    } catch (e) {}
    return clipAt(track, at);
  }

  // Plan B : la séquence est construite clip par clip avec l'API de Premiere.
  function buildWithApi(job, proj, bin) {
    importAll(proj, bin, job.media);
    var segs = job.segments;
    var first = null;
    for (var i = 0; i < segs.length && !first; i++) if (!segs[i].still && !segs[i].mogrt) first = itemFor(proj.rootItem, segs[i].path);
    if (!first) throw new Error('Rushes introuvables dans le projet');
    var seq = proj.createNewSequenceFromClips(job.sequenceName, [first], bin);
    if (!seq) throw new Error('Séquence impossible à créer');
    // La séquence part vide (le 1er rush entier y a été posé).
    var t;
    for (t = 0; t < seq.videoTracks.numTracks; t++) while (seq.videoTracks[t].clips.numItems) seq.videoTracks[t].clips[0].remove(false, false);
    for (t = 0; t < seq.audioTracks.numTracks; t++) while (seq.audioTracks[t].clips.numItems) seq.audioTracks[t].clips[0].remove(false, false);
    for (i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (s.mogrt) continue;
      var it = itemFor(proj.rootItem, s.path);
      if (!it) continue;
      var c = place(seq.videoTracks[0], it, s.start, s.still ? 0 : s['in'], s.still ? s.duration : s.out, !!s.still);
      if (s.still) setScale(c, s.scale);
    }
    var v2 = seq.videoTracks.numTracks > 1 ? seq.videoTracks[1] : null;
    var fxTrack = seq.audioTracks.numTracks > 2 ? seq.audioTracks[2] : seq.audioTracks[seq.audioTracks.numTracks - 1];
    for (i = 0; i < job.overlays.length; i++) {
      var o = job.overlays[i];
      if (o.kind === 'mogrt' || !v2) continue;
      var oi = itemFor(proj.rootItem, o.path);
      if (oi) {
        var oc = place(v2, oi, o.start, o.kind === 'video' ? o.from || 0 : 0, o.kind === 'video' ? (o.from || 0) + o.duration : o.duration, o.kind !== 'video');
        setScale(oc, o.scale);
      }
      if (o.sfx) {
        var si = itemFor(proj.rootItem, o.sfx);
        if (si && fxTrack) fxTrack.overwriteClip(si, ticks(o.start));
      }
    }
    return seq;
  }

  function run(job) {
    var warnings = [];
    var proj = projectFor(job);
    var bin = binNamed(proj.rootItem, job.binName || 'AUTOEDIT');
    var plan = 'xml';
    var before = sequenceIds(proj);
    var seq = null;
    try {
      proj.importFiles([job.xmlPath], true, bin, false);
      seq = newSequence(proj, before, job.sequenceName);
    } catch (e) {
      warnings.push('Import XML : ' + e);
    }
    if (!seq || clipCount(seq) === 0) {
      plan = 'api';
      seq = buildWithApi(job, proj, bin);
    }
    proj.openSequence(seq.sequenceID);
    try {
      proj.activeSequence = seq;
    } catch (e) {}

    // Modèles d'animation (.mogrt) : posés par Premiere lui-même.
    var mogrts = 0;
    for (var i = 0; i < job.overlays.length; i++) {
      var o = job.overlays[i];
      if (o.kind !== 'mogrt') continue;
      try {
        var ti = seq.importMGT(o.path, ticks(o.start), o.track == null ? 2 : o.track, o.audioTrack == null ? 6 : o.audioTrack);
        if (ti && o.duration) ti.end = timeOf(o.start + o.duration);
        mogrts++;
      } catch (e) {
        warnings.push('Modèle ' + o.path + ' : ' + e);
      }
    }

    // Sous-titres : vraie piste de sous-titres Premiere, à partir du .srt.
    var captions = false;
    if (job.srtPath) {
      try {
        importAll(proj, bin, [job.srtPath]);
        var srt = itemFor(proj.rootItem, job.srtPath);
        if (srt) captions = !!seq.createCaptionTrack(srt, 0, Sequence.CAPTION_FORMAT_SUBTITLE);
        if (!captions) warnings.push('Piste de sous-titres non créée');
      } catch (e) {
        warnings.push('Sous-titres : ' + e);
      }
    }
    try {
      proj.save();
    } catch (e) {
      warnings.push('Enregistrement : ' + e);
    }
    return { ok: true, plan: plan, sequence: seq.name, clips: clipCount(seq), mogrts: mogrts, captions: captions, project: proj.path, warnings: warnings };
  }

  return {
    json: json,
    status: function () {
      var p = '';
      try {
        p = app.project ? app.project.path : '';
      } catch (e) {}
      return json({ ok: true, version: app.version, project: p });
    },
    run: function (job) {
      try {
        return json(run(job));
      } catch (e) {
        return json({ ok: false, error: String(e && e.message ? e.message : e), line: e && e.line ? e.line : null });
      }
    },
    _norm: norm,
    _ticks: ticks
  };
})();
