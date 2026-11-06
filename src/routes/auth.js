import {Router} from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import {z} from 'zod';
import {User} from '../models/index.js';
import {config} from '../config.js';
import {asyncRoute,clean,fail,take} from '../utils/http.js';
import {requireAuth} from '../middleware/auth.js';
import {logAction} from '../services/audit.js';
const router=Router();
const email=z.string().email().max(254).transform(x=>x.toLowerCase());
const credentials=z.object({email,password:z.string().min(8).max(128)});
const reg=z.object({name:z.string().trim().min(2).max(150),email,password:z.string().min(10).max(128)});
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const signAccess=user=>jwt.sign({sub:user.id,ver:user.tokenVersion,role:user.role},config.accessSecret,{expiresIn:`${config.accessMinutes}m`,algorithm:'HS256'});
const signRefresh=user=>jwt.sign({sub:user.id,ver:user.tokenVersion,jti:crypto.randomUUID()},config.refreshSecret,{expiresIn:`${config.refreshDays}d`,algorithm:'HS256'});
const cookieOptions={httpOnly:true,secure:config.cookieSecure,sameSite:'lax',path:'/api/v1/auth',maxAge:config.refreshDays*86400000};
function setCookie(res,token){res.cookie('bautek_refresh',token,cookieOptions);}
function clearCookie(res){res.clearCookie('bautek_refresh',{...cookieOptions,maxAge:undefined});}
async function establish(res,user){
  const refresh=signRefresh(user), expiresAt=new Date(Date.now()+config.refreshDays*86400000);
  user.refreshTokenHashes=(user.refreshTokenHashes||[]).filter(x=>x.expiresAt>new Date()).slice(-4);
  user.refreshTokenHashes.push({hash:hash(refresh),expiresAt});
  await user.save(); setCookie(res,refresh);
  return {user:clean(user),accessToken:signAccess(user)};
}
router.post('/register',asyncRoute(async(req,res)=>{
  const value=reg.safeParse(req.body); if(!value.success) fail(400,'Name, valid email and password of at least 10 characters required');
  if(await User.exists({email:value.data.email})) fail(409,'Email is already registered');
  const user=await User.create({name:value.data.name,email:value.data.email,passwordHash:await bcrypt.hash(value.data.password,12),role:'client'});
  res.status(201).json({user:clean(user),message:'Account created; please sign in'});
}));
router.post('/login',asyncRoute(async(req,res)=>{
  const input=credentials.safeParse(req.body); if(!input.success) fail(400,'Valid email and password required');
  const user=await User.findOne({email:input.data.email}).select('+passwordHash');
  if(!user||!user.active||!(await bcrypt.compare(input.data.password,user.passwordHash))) fail(401,'Invalid email or password');
  user.lastLogin=new Date();const result=await establish(res,user);res.json(result);
}));
router.post('/refresh',asyncRoute(async(req,res)=>{
  const token=req.cookies?.bautek_refresh;if(!token) fail(401,'No refresh session');
  let p;try{p=jwt.verify(token,config.refreshSecret,{algorithms:['HS256']});}catch{clearCookie(res);fail(401,'Expired refresh session');}
  const user=await User.findOne({id:p.sub,active:true});
  if(!user||user.tokenVersion!==p.ver||!user.refreshTokenHashes.some(x=>x.hash===hash(token)&&x.expiresAt>new Date())){clearCookie(res);fail(401,'Session revoked');}
  // Rotate refresh token; a replay of an old token is rejected.
  user.refreshTokenHashes=user.refreshTokenHashes.filter(x=>x.hash!==hash(token));
  const result=await establish(res,user);res.json(result);
}));
router.post('/logout',asyncRoute(async(req,res)=>{
  const token=req.cookies?.bautek_refresh;
  if(token){const decoded=jwt.decode(token);if(decoded?.sub){await User.updateOne({id:decoded.sub},{$pull:{refreshTokenHashes:{hash:hash(token)}}});}}
  clearCookie(res);res.json({message:'Signed out'});
}));
router.get('/me',requireAuth,(req,res)=>res.json({user:clean(req.auth.user)}));
router.patch('/me',requireAuth,asyncRoute(async(req,res)=>{
  const allowed=['name','phone','specialties','specializations','otherSpecialty','yearsExperience','experience','qualifications','professionalRegistration','professionalBio','bio'];
  const data=take(req.body,allowed);
  if(req.auth.role!=='admin') for(const k of ['specialties','specializations','otherSpecialty','yearsExperience','experience','qualifications','professionalRegistration','professionalBio']) delete data[k];
  if(data.specialties && (!Array.isArray(data.specialties)||data.specialties.length>35||data.specialties.some(x=>typeof x!=='string'||x.length>100))) fail(400,'Invalid specialties');
  if(data.yearsExperience!==undefined && (!Number.isFinite(Number(data.yearsExperience))||Number(data.yearsExperience)<0)) fail(400,'Invalid yearsExperience');
  Object.assign(req.auth.user,data);
  if(req.auth.role==='admin' && ((data.specialties?.length||0)>0||String(data.otherSpecialty||'').trim()))req.auth.user.profileCompleted=true;
  await req.auth.user.save();await logAction(req,'PROFILE_UPDATED','users',req.auth.id,Object.keys(data));
  res.json({user:clean(req.auth.user)});
}));
export default router;
