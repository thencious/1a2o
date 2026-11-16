export function atomicWrite(file:string,value:string):Promise<void>;
export function readJson<T=unknown>(file:string,fallback?:T):Promise<T>;
export function localKey(env?:NodeJS.ProcessEnv):Buffer;
export function seal(value:string,key:Buffer,prefix?:string):string;
export function unseal(value:string,key:Buffer,prefix?:string):string;
export function withFileLock<T>(file:string,operation:()=>Promise<T>):Promise<T>;

export function packCloudState(state:unknown,key:Buffer):string;
export function unpackCloudState<T=unknown>(payload:string,key:Buffer):T;
