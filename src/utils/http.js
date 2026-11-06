export class HttpError extends Error { constructor(status, message, code='REQUEST_ERROR') { super(message); this.status=status; this.code=code; } }
export const fail = (status, message, code) => { throw new HttpError(status, message, code); };
export const asyncRoute = fn => (req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
export const clean = doc => {
  if (!doc) return null;
  const v = typeof doc.toObject === 'function' ? doc.toObject({virtuals:false}) : {...doc};
  if (v._id && !v.id) v.id=String(v._id);
  delete v._id; delete v.__v; delete v.passwordHash; delete v.refreshTokenHashes;
  return v;
};
export const take = (object, keys) => Object.fromEntries(keys.filter(k=>Object.hasOwn(object||{},k)).map(k=>[k,object[k]]));
export const same = (a,b) => !!a && !!b && String(a)===String(b);
export const isAmount = v => typeof v==='number' && Number.isFinite(v) && v >= 0;
export function parseAmount(v, positive=false) { const n=Number(v); if (!Number.isFinite(n) || (positive ? n<=0 : n<0)) fail(400,'Invalid nonnegative monetary amount'); return Math.round(n*100)/100; }
export function validDate(input) { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input||'')) || Number.isNaN(Date.parse(input+'T00:00:00Z'))) fail(400,'Expected a valid YYYY-MM-DD date'); return input; }
export const idOr400 = id => { if (!/^[A-Za-z0-9_-]{1,96}$/.test(String(id||''))) fail(400,'Invalid record identifier'); return id; };
