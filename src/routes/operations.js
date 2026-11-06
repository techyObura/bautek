import {Router} from 'express';
import {Project,Property,Tenant,RentPayment,Transaction,User} from '../models/index.js';
import {requireAuth,requireRole} from '../middleware/auth.js';
import {asyncRoute,clean,fail,same,parseAmount,validDate,take,idOr400} from '../utils/http.js';
import {canReadProject,canReadProperty,canManageProperty,adminOn} from '../services/permissions.js';
import {logAction} from '../services/audit.js';
import {rentStatement,propertyStatement} from '../services/ledger.js';
const router=Router();router.use(requireAuth);
const projectFor=async id=>{const p=await Project.findOne({id:idOr400(id)});if(!p)fail(404,'Project not found');return p;};
const propertyFor=async id=>{const p=await Property.findOne({id:idOr400(id)});if(!p)fail(404,'Property not found');return p;};
const propertyAccess=async(req,p,manage=false)=>{
 const project=p.projectId?await Project.findOne({id:p.projectId}):null;
 if(!(manage?canManageProperty(req.auth,p,project):canReadProperty(req.auth,p,project)))fail(403,'Property access denied');
};
router.post('/projects/:id/decision',requireRole('super_admin'),asyncRoute(async(req,res)=>{
 const p=await projectFor(req.params.id),decision=req.body?.decision;
 if(!['Approved','Rejected'].includes(decision))fail(400,'decision must be Approved or Rejected');
 if(p.approvalStatus!=='Pending')fail(409,'Project has already been reviewed');
 p.approvalStatus=decision;p.status=decision==='Approved'?'Approved':'Rejected';p.reviewedBy=req.auth.id;p.reviewedAt=new Date();p.reviewReason=String(req.body.reason||'').slice(0,1000);await p.save();
 await logAction(req,'PROJECT_DECISION','projects',p.id,{decision});res.json({data:clean(p)});
}));
router.post('/projects/:id/assignments',requireRole('super_admin'),asyncRoute(async(req,res)=>{
 const p=await projectFor(req.params.id);
 if(p.approvalStatus!=='Approved')fail(409,'Approve project before assigning admins');
 const {adminId,responsibility}=req.body||{};
 if(typeof responsibility!=='string'||!responsibility.trim()||responsibility.length>150)fail(400,'Responsibility required');
 const admin=await User.findOne({id:adminId,role:'admin',active:true});if(!admin)fail(400,'Selected admin is not active');
 if(!admin.profileCompleted||!(admin.specialties?.length||admin.otherSpecialty))fail(409,'Admin must complete specialties profile');
 if(p.adminAssignments.some(a=>same(a.adminId,adminId)&&a.responsibility===responsibility.trim()))fail(409,'Duplicate assignment');
 p.adminAssignments.push({adminId,adminName:admin.name,responsibility:responsibility.trim(),assignedBy:req.auth.id,assignedAt:new Date()});p.status='Active';await p.save();
 await logAction(req,'PROJECT_ASSIGNED','projects',p.id,{adminId,responsibility});res.status(201).json({data:clean(p)});
}));
router.delete('/projects/:id/assignments/:adminId',requireRole('super_admin'),asyncRoute(async(req,res)=>{
 const p=await projectFor(req.params.id);const before=p.adminAssignments.length;
 p.adminAssignments=p.adminAssignments.filter(a=>!same(a.adminId,req.params.adminId)||req.query.responsibility&&a.responsibility!==req.query.responsibility);
 if(before===p.adminAssignments.length)fail(404,'Assignment not found');await p.save();await logAction(req,'PROJECT_ASSIGNMENT_REMOVED','projects',p.id,{adminId:req.params.adminId});res.json({data:clean(p)});
}));
router.patch('/users/:id/role',requireRole('super_admin'),asyncRoute(async(req,res)=>{
 const role=req.body?.role;if(!['client','contractor','admin','tenant'].includes(role))fail(400,'Invalid target role');
 const u=await User.findOne({id:req.params.id});if(!u)fail(404,'User not found');if(same(u.id,req.auth.id))fail(403,'Cannot change your own role');
 if(u.role==='super_admin')fail(403,'Super admin changes require controlled recovery');
 const before=u.role;u.role=role;u.tokenVersion+=1;u.refreshTokenHashes=[];
 if(role==='admin'&&before!=='admin'){u.profileCompleted=false;u.specialties=[];u.specializations=[];}
 await u.save();await logAction(req,'ROLE_CHANGED','users',u.id,{before,after:role});res.json({data:clean(u)});
}));
router.patch('/users/:id/state',requireRole('super_admin'),asyncRoute(async(req,res)=>{
 const u=await User.findOne({id:req.params.id});if(!u)fail(404,'User not found');if(same(u.id,req.auth.id))fail(403,'Cannot deactivate your own account');
 if(typeof req.body?.active!=='boolean')fail(400,'active must be boolean');u.active=req.body.active;u.tokenVersion++;u.refreshTokenHashes=[];await u.save();
 await logAction(req,'USER_STATE_CHANGED','users',u.id,{active:u.active});res.json({data:clean(u)});
}));
router.post('/tenants/:id/removal-request',requireRole('admin','super_admin'),asyncRoute(async(req,res)=>{
 const t=await Tenant.findOne({id:req.params.id});if(!t)fail(404,'Tenant not found');const p=await propertyFor(t.propertyId);await propertyAccess(req,p,true);
 if(t.status!=='Active')fail(409,'Tenant is not active');t.status='Removal requested';t.removalReason=String(req.body.reason||'').slice(0,1000);t.removalRequestedBy=req.auth.id;t.removalRequestedAt=new Date();await t.save();
 await logAction(req,'TENANT_REMOVAL_REQUESTED','tenants',t.id);res.json({data:clean(t)});
}));
router.post('/tenants/:id/removal-decision',requireRole('super_admin'),asyncRoute(async(req,res)=>{
 const t=await Tenant.findOne({id:req.params.id});if(!t)fail(404,'Tenant not found');if(t.status!=='Removal requested')fail(409,'No pending removal request');
 if(!['remove','reinstate'].includes(req.body?.decision))fail(400,'decision must be remove or reinstate');
 t.status=req.body.decision==='remove'?'Removed':'Active';t.removalReviewedBy=req.auth.id;t.removalReviewedAt=new Date();await t.save();
 await logAction(req,'TENANT_REMOVAL_DECIDED','tenants',t.id,{decision:req.body.decision});res.json({data:clean(t)});
}));
router.post('/rent-payments/:id/verify',requireRole('super_admin'),asyncRoute(async(req,res)=>{
 const payment=await RentPayment.findOne({id:req.params.id});if(!payment)fail(404,'Receipt not found');
 if(payment.status!=='Pending')fail(409,'Receipt is not pending');
 if(!String(req.body?.evidence||'').trim())fail(400,'Verification evidence required');
 payment.status='Confirmed';payment.verifiedBy=req.auth.id;payment.verifiedAt=new Date();payment.verificationEvidence=String(req.body.evidence).slice(0,1500);await payment.save();
 await logAction(req,'RENT_PAYMENT_CONFIRMED','rentPayments',payment.id);res.json({data:clean(payment)});
}));
router.post('/rent-payments/:id/reverse',requireRole('super_admin'),asyncRoute(async(req,res)=>{
 const payment=await RentPayment.findOne({id:req.params.id});if(!payment)fail(404,'Receipt not found');if(payment.status==='Reversed')fail(409,'Already reversed');
 if(!String(req.body.reason||'').trim())fail(400,'Reversal reason required');payment.status='Reversed';payment.reversalReason=String(req.body.reason).slice(0,1000);await payment.save();
 await logAction(req,'RENT_PAYMENT_REVERSED','rentPayments',payment.id);res.json({data:clean(payment)});
}));
router.get('/tenants/:id/statement',asyncRoute(async(req,res)=>{
 const t=await Tenant.findOne({id:req.params.id});if(!t)fail(404,'Tenant not found');
 const p=await propertyFor(t.propertyId);
 if(!(req.auth.role==='tenant'&&same(t.userId,req.auth.id))){await propertyAccess(req,p,false);}
 const asOf=req.query.asOf?validDate(req.query.asOf):new Date().toISOString().slice(0,10);
 const pays=await RentPayment.find({tenantId:t.id});res.json({data:rentStatement(t,pays,asOf)});
}));
router.get('/properties/:id/statement',asyncRoute(async(req,res)=>{
 const p=await propertyFor(req.params.id);await propertyAccess(req,p);
 const asOf=req.query.asOf?validDate(req.query.asOf):new Date().toISOString().slice(0,10);
 const [tenants,payments,txns]=await Promise.all([Tenant.find({propertyId:p.id}),RentPayment.find({propertyId:p.id}),Transaction.find({propertyId:p.id})]);
 res.json({data:propertyStatement(p,tenants,payments,txns,asOf)});
}));
router.get('/dashboard',asyncRoute(async(req,res)=>{
 const [projects,properties,tenants,payments,txns]=await Promise.all([Project.find(),Property.find(),Tenant.find(),RentPayment.find(),Transaction.find()]);
 const readableProjects=projects.filter(p=>canReadProject(req.auth,p));
 const readableProperties=properties.filter(p=>canReadProperty(req.auth,p,projects.find(project=>same(project.id,p.projectId))));
 const tenantRows=req.auth.role==='tenant'?tenants.filter(t=>same(t.userId,req.auth.id)):tenants.filter(t=>readableProperties.some(p=>same(p.id,t.propertyId)));
 const propertyIds=new Set(readableProperties.map(p=>String(p.id)));
 const relevantPays=payments.filter(p=>propertyIds.has(String(p.propertyId))||(req.auth.role==='tenant'&&tenantRows.some(t=>same(t.id,p.tenantId))));
 const summaries=readableProperties.map(p=>propertyStatement(p,tenantRows.filter(t=>same(t.propertyId,p.id)),relevantPays,txns.filter(t=>same(t.propertyId,p.id))));
 res.json({data:{role:req.auth.role,projects:readableProjects.length,pendingApprovals:req.auth.role==='super_admin'?projects.filter(p=>p.approvalStatus==='Pending').length:0,properties:readableProperties.length,tenancies:tenantRows.length,propertySummaries:summaries,tenantStatements:tenantRows.map(t=>rentStatement(t,relevantPays))}});
}));
export default router;
