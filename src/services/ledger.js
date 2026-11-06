/** Ledger values are calculated from server-confirmed receipts only. All values KES. */
export function monthsDue(start, asOf=new Date().toISOString().slice(0,10),end=null){
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(start||''))) return 0;
  const stop=end&&end<asOf?end:asOf;
  if (stop<start) return 0;
  const [sy,sm]=start.split('-').map(Number),[ey,em]=stop.split('-').map(Number);
  return Math.max(0,(ey-sy)*12+em-sm+1);
}
export const roundMoney=x=>Math.round((Number(x)||0)*100)/100;
export function rentStatement(tenant,payments,asOf=new Date().toISOString().slice(0,10)){
  const verified=payments.filter(p=>['Confirmed','Recorded'].includes(p.status)&&String(p.tenantId)===String(tenant.id)&&p.date<=asOf);
  const received=roundMoney(verified.reduce((a,p)=>a+Number(p.amount||0),0));
  const expected=roundMoney(monthsDue(tenant.leaseStart,asOf,tenant.leaseEnd)*Number(tenant.monthlyRent||0));
  const balance=roundMoney(expected-received-Number(tenant.openingCredit||0));
  return {tenantId:tenant.id,asOf,monthsBilled:monthsDue(tenant.leaseStart,asOf,tenant.leaseEnd),monthlyRent:tenant.monthlyRent,expected,received,arrears:Math.max(0,balance),credit:Math.max(0,-balance),rating:expected?Math.min(100,Math.round(100*Math.min(1,(received+Number(tenant.openingCredit||0))/expected))):100,receipts:verified.length};
}
export function propertyStatement(property,tenants,payments,transactions,asOf=new Date().toISOString().slice(0,10)){
  const tenantIds=new Set(tenants.map(t=>String(t.id)));
  const rents=payments.filter(p=>tenantIds.has(String(p.tenantId))&&['Recorded','Confirmed'].includes(p.status)&&p.date<=asOf);
  const income=roundMoney(rents.reduce((a,p)=>a+Number(p.amount),0)+transactions.filter(t=>String(t.propertyId)===String(property.id)&&['income','Income'].includes(t.type)&&t.status!=='Reversed'&&t.date<=asOf).reduce((a,t)=>a+Number(t.amount),0));
  const expense=roundMoney(transactions.filter(t=>String(t.propertyId)===String(property.id)&&['expense','Expense'].includes(t.type)&&t.status!=='Reversed'&&t.date<=asOf).reduce((a,t)=>a+Number(t.amount),0));
  const remitted=roundMoney(transactions.filter(t=>String(t.propertyId)===String(property.id)&&['remittance','Remittance'].includes(t.type)&&t.status!=='Reversed'&&t.date<=asOf).reduce((a,t)=>a+Number(t.amount),0));
  return {propertyId:property.id,asOf,income,expense,remitted,netIncome:roundMoney(income-expense),availableForOwner:roundMoney(income-expense-remitted),arrears:roundMoney(tenants.reduce((a,t)=>a+rentStatement(t,payments,asOf).arrears,0))};
}
