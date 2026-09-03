import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, normalizeRows, summarize, forecastCoverage, transferPlan, exportActions } from '../lib/workforce.mjs';

test('quoted CSV parses',()=>{const x=parseCSV('date,team,employee_id,scheduled_hours,productive_hours,absence_hours,demand_units\n2026-01-01,"A, East",e1,8,7,0,70');assert.equal(x[0].team,'A, East');});
test('normalizer rejects missing columns',()=>{const n=normalizeRows([{date:'2026-01-01'}]);assert.ok(n.errors.length>0);});
test('summary computes capacity after absence',()=>{const rows=[{date:'2026-01-01',team:'A',role:'x',employee_id:'1',scheduled_hours:8,productive_hours:6,absence_hours:2,demand_units:60}];const s=summarize(rows);assert.equal(s.teams[0].capacity,6);});
test('forecast produces requested horizon per team',()=>{const rows=[];for(let i=1;i<=30;i++)rows.push({date:`2026-01-${String(i).padStart(2,'0')}`,team:'A',role:'x',employee_id:'1',scheduled_hours:8,productive_hours:7,absence_hours:0,demand_units:70+i});const f=forecastCoverage(rows,{horizon:7});assert.equal(f.length,7);});
test('higher service quantile does not reduce required hours',()=>{const rows=[];for(let i=1;i<=30;i++)rows.push({date:`2026-01-${String(i).padStart(2,'0')}`,team:'A',role:'x',employee_id:'1',scheduled_hours:8,productive_hours:7,absence_hours:0,demand_units:60+(i%7)*8});const a=forecastCoverage(rows,{horizon:3,serviceQuantile:.5});const b=forecastCoverage(rows,{horizon:3,serviceQuantile:.9});assert.ok(b[0].requiredHours>=a[0].requiredHours);});
test('transfer plan reallocates excess before adding capacity',()=>{const f=[{date:'2026-01-01',team:'A',gap:5},{date:'2026-01-01',team:'B',gap:-4}];const p=transferPlan(f);assert.equal(p[0].kind,'REALLOCATE');assert.equal(p[0].hours,4);assert.equal(p[1].kind,'ADD_CAPACITY');});
test('export contains operational action',()=>{const csv=exportActions([{date:'2026-01-01',kind:'ADD_CAPACITY',from:'Unfilled',to:'A',hours:3.5}]);assert.match(csv,/ADD_CAPACITY/);});
