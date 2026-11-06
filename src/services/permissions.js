import {same} from '../utils/http.js';
export const adminOn=(p,id)=>[...(p?.adminAssignments||[])].some(a=>same(a.adminId,id))||same(p?.assignedAdminId,id);
export const propertyAdmin=(p,id)=>Array.isArray(p?.adminIds)&&p.adminIds.some(x=>same(x,id));
export function canReadProject(auth,p){if(!p)return false;return auth.role==='super_admin'||auth.role==='client'&&same(p.ownerId,auth.id)||auth.role==='admin'&&adminOn(p,auth.id)||auth.role==='contractor'&&(same(p.contractorId,auth.id)||p.contractor===auth.user?.name);}
export function canReadProperty(auth,p,project){if(!p)return false;return auth.role==='super_admin'||auth.role==='client'&&same(p.ownerId,auth.id)||auth.role==='admin'&&(propertyAdmin(p,auth.id)||project&&adminOn(project,auth.id));}
export function canManageProperty(auth,p,project){return auth.role==='super_admin'||auth.role==='admin'&&(propertyAdmin(p,auth.id)||project&&adminOn(project,auth.id));}
export const projectFields=['name','type','county','budget','delivery','contractor','details','visibility'];
export const profileFields=['name','phone','specialties','specializations','otherSpecialty','yearsExperience','experience','qualifications','professionalRegistration','professionalBio','bio'];
