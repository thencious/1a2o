export function validOrigin(origin, baseUrl) {
  return origin === baseUrl || origin === baseUrl.replace('localhost', '127.0.0.1');
}
export function childEnvironment(source) {
  const keys = ['PATH','PATHEXT','SystemRoot','WINDIR','COMSPEC','USERPROFILE','HOMEDRIVE','HOMEPATH','LOCALAPPDATA','APPDATA','TEMP','TMP','USERNAME','OS','PROCESSOR_ARCHITECTURE','PROGRAMFILES','ProgramFiles(x86)','CODEX_HOME'];
  return Object.fromEntries(Object.entries(source).filter(([key]) => keys.some(allowed => allowed.toLowerCase()===key.toLowerCase())));
}
export function panelOptions(value, previous = {}) {
  const result = {...previous};
  for (const key of ['chat_id','chat_title','cwd','model','effort','message']) {
    if (value[key] !== undefined) {
      if (typeof value[key] !== 'string' || value[key].length > (key==='message'?200000:4096)) throw new Error('Invalid agent setting.');
      result[key]=value[key];
    }
  }
  if(value.cwd_manual !== undefined) result.cwd_manual=Boolean(value.cwd_manual);
  return result;
}
