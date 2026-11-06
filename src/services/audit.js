import {Audit} from '../models/index.js';
export async function logAction(req,action,entity,entityId,details={}) {
  await Audit.create({actorId:req.auth?.id||'system',actorRole:req.auth?.role||'system',action,entity,entityId,details,ip:req.ip});
}
