import test from 'node:test';
import assert from 'node:assert/strict';
import {panelTaskIds,nextScheduledCallDue} from './scheduled-calls.mjs';
test('each panel retains old and new calls once',()=>assert.deepEqual(panelTaskIds({taskId:'a',taskIds:['a','b']}),['a','b']));
test('additional calls start one hour after the previous active call',()=>assert.equal(nextScheduledCallDue([{status:'scheduled',due:8000},{status:'scheduled',due:12000}],1000),15600));
test('paused and expired calls still produce a future schedule',()=>{assert.equal(nextScheduledCallDue([{status:'paused',remaining:200}],1000),4800);assert.equal(nextScheduledCallDue([{status:'scheduled',due:500}],1000),4600);assert.equal(nextScheduledCallDue([{status:'cancelled',due:90000}],1000),4600);});
