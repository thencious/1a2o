import {test} from 'node:test';
import assert from 'node:assert/strict';
import {childEnvironment,panelOptions,validOrigin} from './policy.mjs';
test('only the configured app origin can attach a terminal',()=>{
 assert(validOrigin('http://localhost:3000','http://localhost:3000'));
 assert(validOrigin('http://127.0.0.1:3000','http://localhost:3000'));
 for(const origin of [undefined,'null','http://localhost:3001','https://evil.example','http://localhost:3000.evil.example'])assert(!validOrigin(origin,'http://localhost:3000'));
});
test('agent subprocesses do not inherit mailbox or provider secrets',()=>{
 assert.deepEqual(childEnvironment({PATH:'tools',USERPROFILE:'user',SystemRoot:'Windows',AUTH_SECRET:'secret',OPENROUTER_API_KEY:'secret',INTERNAL_API_KEY:'secret',GOOGLE_CLIENT_SECRET:'secret'}),{PATH:'tools',USERPROFILE:'user',SystemRoot:'Windows'});
});
test('panel updates cannot inject executable paths, task identities or oversized prompts',()=>{
 assert.deepEqual(panelOptions({message:'hello',executable:'evil',taskId:'other'},{taskId:'original'}),{taskId:'original',message:'hello'});
 assert.throws(()=>panelOptions({message:'x'.repeat(200001)}));
 assert.throws(()=>panelOptions({cwd:[]}));
});
