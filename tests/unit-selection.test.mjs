import test from 'node:test';
import assert from 'node:assert/strict';
import { containsPoint, selectUnits, normalizePrefixes } from '../lib/unit-selection.mjs';
const region=[{x:0,y:0},{x:100,y:0},{x:100,y:40},{x:40,y:40},{x:40,y:100},{x:0,y:100}];
test('selection includes boundary and excludes concave cutout, not just bounding box',()=>{
  assert.equal(containsPoint({x:40,y:70},region),true);
  assert.equal(containsPoint({x:70,y:70},region),false);
  const units=selectUnits(region,[{code:'TH8-01',x:20,y:20,priority:1},{code:'TH8-02',x:70,y:70,priority:1},{code:'TH8-03',x:120,y:30,priority:1}]);
  assert.deepEqual(units.map(u=>u.code),['TH8-01']);
});
test('OCR prefix correction uses a unique existing project prefix and preserves lot number',()=>{
  const records=[{code:'THBA-168',priority:1},{code:'BM8-08',priority:1},{code:'THBA-170',priority:3}];
  const result=normalizePrefixes(records,['TH8A-170','BM8-01']);
  assert.equal(result[0].code,'TH8A-168');assert.equal(result[1].code,'BM8-08');assert.equal(result[2].code,'THBA-170');
  assert.equal(normalizePrefixes(records,['TH8A-170','THBA-120'])[0].code,'THBA-168');
});
test('verified positions outrank OCR; conflicting same-priority positions require review',()=>{
  const units=selectUnits(region,[{code:'TH8-01',x:10,y:10,priority:1},{code:'TH8-01',x:20,y:20,priority:3},{code:'TH8-02',x:5,y:5,priority:1},{code:'TH8-02',x:90,y:5,priority:1}]);
  assert.equal(units[0].x,20);assert.equal(units[1].conflict,true);assert.equal(units[1].enabled,false);
  assert.equal(selectUnits(region,[{code:'TH8-03',x:10,y:10,priority:1},{code:'TH8-03',x:200,y:200,priority:3}]).length,0);
});
