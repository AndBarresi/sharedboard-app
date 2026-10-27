// SharedBoard.app — Andrew Barresi (https://github.com/AndBarresi). MIT.
// The website presents the setup. GitHub serves only the public ZIP bytes.
export const bridgeDownloadTargets=Object.freeze(['windows-x64','macos-arm64','macos-x64']);
const releases='https://github.com/AndBarresi/sharedboard-app/releases/latest/download/';
export function bridgeDownloadPath(target){
  if(!bridgeDownloadTargets.includes(target))throw new Error('Choose a supported bridge download.');
  return `/downloads/SharedBoard-Bridge-${target}.zip`;
}
export function bridgeDownloadRedirect(pathname){
  const target=bridgeDownloadTargets.find(value=>bridgeDownloadPath(value)===pathname);
  return target?`${releases}SharedBoard-Bridge-${target}.zip`:null;
}
