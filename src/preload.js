'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('filedit', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  notesList: () => ipcRenderer.invoke('notes:list'),
  inboxLearn: (msg, positive) => ipcRenderer.invoke('inbox:learn', msg, positive),
  inboxModelStats: () => ipcRenderer.invoke('inbox:modelStats'),
  inboxModelReset: () => ipcRenderer.invoke('inbox:modelReset'),
  notesRead: (name) => ipcRenderer.invoke('notes:read', name),
  notesSave: (name, content) => ipcRenderer.invoke('notes:save', name, content),
  notesCreate: (base) => ipcRenderer.invoke('notes:create', base),
  notesRename: (from, to) => ipcRenderer.invoke('notes:rename', from, to),
  notesDelete: (name) => ipcRenderer.invoke('notes:delete', name),
  notesOpenDir: () => ipcRenderer.invoke('notes:open'),
  notesChooseDir: () => ipcRenderer.invoke('notes:chooseDir'),
  notesPick: (kind) => ipcRenderer.invoke('notes:pick', kind),
  notesExists: (paths) => ipcRenderer.invoke('notes:exists', paths),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  removeRecent: (dir) => ipcRenderer.invoke('recent:remove', dir),
  pickFolder: (opts) => ipcRenderer.invoke('dialog:folder', opts),
  pickPrproj: () => ipcRenderer.invoke('dialog:prproj'),
  exists: (p) => ipcRenderer.invoke('fs:exists', p),
  projectExists: (name) => ipcRenderer.invoke('fs:projectExists', name),
  open: (p) => ipcRenderer.invoke('shell:open', p),
  reveal: (p) => ipcRenderer.invoke('shell:reveal', p),
  external: (url) => ipcRenderer.invoke('shell:external', url),
  inspect: (url, account) => ipcRenderer.invoke('drive:inspect', url, account),
  scanExports: () => ipcRenderer.invoke('exports:scan'),
  renameExports: (ops) => ipcRenderer.invoke('exports:rename', ops),
  chromeProfiles: () => ipcRenderer.invoke('chrome:profiles'),
  googleSetClient: (c) => ipcRenderer.invoke('google:setClient', c),
  googleConnect: () => ipcRenderer.invoke('google:connect'),
  googleCancel: () => ipcRenderer.invoke('google:cancel'),
  googleRemove: (email) => ipcRenderer.invoke('google:remove', email),
  googleAuthorize: (email, feature) => ipcRenderer.invoke('google:authorize', email, feature),
  inboxMail: (email, opts) => ipcRenderer.invoke('inbox:mail', email, opts),
  inboxMailGet: (email, id, threadId, meta) => ipcRenderer.invoke('inbox:mailGet', email, id, threadId, meta),
  chromeLogin: (add) => ipcRenderer.invoke('chrome:login', add),
  chromeRefresh: () => ipcRenderer.invoke('chrome:refresh'),
  chromeShow: () => ipcRenderer.invoke('chrome:show'),
  chromeHide: () => ipcRenderer.invoke('chrome:hide'),
  chromeReset: () => ipcRenderer.invoke('chrome:reset'),
  inboxSpaces: (email, opts) => ipcRenderer.invoke('inbox:spaces', email, opts),
  inboxMailBodies: (email, items) => ipcRenderer.invoke('inbox:mailBodies', email, items),
  inboxChatDiagnostic: (email, space) => ipcRenderer.invoke('inbox:chatDiagnostic', email, space),
  inboxChat: (email, space, opts) => ipcRenderer.invoke('inbox:chat', email, space, opts),
  createProject: (payload) => ipcRenderer.invoke('project:create', payload),
  cancelProject: () => ipcRenderer.invoke('project:cancel'),
  finishImport: () => ipcRenderer.invoke('project:finishImport'),
  reopenBrowser: () => ipcRenderer.invoke('project:reopenBrowser'),
  scanLibrary: () => ipcRenderer.invoke('library:scan'),
  scanProject: (dir) => ipcRenderer.invoke('library:project', dir),
  setProjectMeta: (dir, patch) => ipcRenderer.invoke('project:meta', dir, patch),
  thumbLookup: (items) => ipcRenderer.invoke('thumb:lookup', items),
  thumbSave: (key, bytes) => ipcRenderer.invoke('thumb:save', key, bytes),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  updateState: () => ipcRenderer.invoke('update:state'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdate: (cb) => {
    const listener = (_e, s) => cb(s);
    ipcRenderer.on('update:status', listener);
    return () => ipcRenderer.removeListener('update:status', listener);
  },
  localInspect: (dir) => ipcRenderer.invoke('local:inspect', dir),
  // Chemin d'un dossier glissé dans la fenêtre.
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
  autoeditOpen: (dir) => ipcRenderer.invoke('autoedit:open', dir),
  autoeditAnalyze: (files) => ipcRenderer.invoke('autoedit:analyze', files),
  autoeditCancel: () => ipcRenderer.invoke('autoedit:cancel'),
  autoeditProxy: (file, duration) => ipcRenderer.invoke('autoedit:proxy', file, duration),
  autoeditSave: (dir, data) => ipcRenderer.invoke('autoedit:save', dir, data),
  autoeditSfxDir: () => ipcRenderer.invoke('autoedit:sfxDir'),
  autoeditExport: (payload) => ipcRenderer.invoke('autoedit:export', payload),
  subsStatus: () => ipcRenderer.invoke('subs:status'),
  subsDownload: (model) => ipcRenderer.invoke('subs:download', model),
  subsTranscribe: (files, opts) => ipcRenderer.invoke('subs:transcribe', files, opts),
  subsCancel: () => ipcRenderer.invoke('subs:cancel'),
  autoeditJobState: (id, checkRunning) => ipcRenderer.invoke('autoedit:jobState', id, checkRunning),
  autoeditLaunchPremiere: (prproj) => ipcRenderer.invoke('autoedit:launchPremiere', prproj),
  autoeditSaveSubs: (dir, images) => ipcRenderer.invoke('autoedit:saveSubs', dir, images),
  autoeditPickPremiere: () => ipcRenderer.invoke('autoedit:pickPremiere'),
  onAutoEdit: (cb) => {
    const listener = (_e, msg) => cb(msg);
    ipcRenderer.on('autoedit:progress', listener);
    return () => ipcRenderer.removeListener('autoedit:progress', listener);
  },
  onJobUpdate: (cb) => {
    const listener = (_e, state) => cb(state);
    ipcRenderer.on('job:update', listener);
    return () => ipcRenderer.removeListener('job:update', listener);
  }
});
