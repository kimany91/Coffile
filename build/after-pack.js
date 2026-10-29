// Mac : signature « ad hoc » (sans compte développeur Apple). Sans elle, l'app ne se lance pas sur
// les Mac Apple Silicon ; les outils inclus (ffmpeg, whisper) sont signés aussi.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const res = path.join(appPath, 'Contents', 'Resources');
  for (const tool of ['ffmpeg/ffmpeg', 'whisper/whisper-cli']) {
    const file = path.join(res, tool);
    if (!fs.existsSync(file)) throw new Error(`Outil manquant dans l'app : ${tool}`);
    fs.chmodSync(file, 0o755);
    execFileSync('codesign', ['--force', '--sign', '-', file], { stdio: 'inherit' });
  }
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], { stdio: 'inherit' });
};
