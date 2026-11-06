import test from 'node:test';
import assert from 'node:assert/strict';
import {monthsDue,rentStatement,propertyStatement} from '../src/services/ledger.js';
test('lease monthly count is inclusive and respects end date',()=>{
 assert.equal(monthsDue('2026-01-15','2026-03-01'),3);
 assert.equal(monthsDue('2026-01-15','2026-05-01','2026-02-28'),2);
 assert.equal(monthsDue('2027-01-01','2026-05-01'),0);
});
test('only verified rent reduces arrears; advance payment produces credit',()=>{
 const tenant={id:'TEN1',monthlyRent:10000,leaseStart:'2026-01-01',openingCredit:1000};
 let receipts=[{tenantId:'TEN1',amount:5000,status:'Pending',date:'2026-01-20'}];
 assert.deepEqual([rentStatement(tenant,receipts,'2026-02-20').received,rentStatement(tenant,receipts,'2026-02-20').arrears],[0,19000]);
 receipts.push({tenantId:'TEN1',amount:23000,status:'Confirmed',date:'2026-02-20'});
 assert.deepEqual([rentStatement(tenant,receipts,'2026-02-20').credit,rentStatement(tenant,receipts,'2026-02-20').rating],[4000,100]);
});
test('property owner balance accounts for expenses and remittances',()=>{
 const property={id:'PROP1'};
 const tenant=[{id:'TEN1',propertyId:'PROP1',monthlyRent:10000,leaseStart:'2026-01-01'}];
 const pays=[{tenantId:'TEN1',amount:10000,status:'Confirmed',date:'2026-01-05'}];
 const tx=[{propertyId:'PROP1',type:'expense',amount:2000,date:'2026-01-06'},{propertyId:'PROP1',type:'remittance',amount:5000,date:'2026-01-07'}];
 assert.equal(propertyStatement(property,tenant,pays,tx,'2026-01-31').availableForOwner,3000);
});
