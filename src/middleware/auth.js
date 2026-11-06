import jwt from 'jsonwebtoken';
import {config} from '../config.js';
import {User} from '../models/index.js';
import {asyncRoute,fail} from '../utils/http.js';
export const requireAuth=asyncRoute(async(req,res,next)=>{
  const token=(req.get('authorization')||'').match(/^Bearer\s+(.+)$/i)?.[1];
  if(!token) fail(401,'Sign in required');
  let payload; try {payload=jwt.verify(token,config.accessSecret,{algorithms:['HS256']});} catch {fail(401,'Expired or invalid access token');}
  const user=await User.findOne({id:payload.sub,active:true});
  if(!user || user.tokenVersion!==payload.ver) fail(401,'Session has been revoked');
  req.auth={id:user.id,role:user.role,user}; next();
});
export const requireRole=(...roles)=>(req,res,next)=>roles.includes(req.auth?.role)?next():next(Object.assign(new Error('Access denied'),{status:403}));
