import {Router} from 'express';
import {Listing} from '../models/index.js';
import {asyncRoute,clean} from '../utils/http.js';
const router=Router();
// Marketplace pages can browse published ads without signing in.
router.get('/marketplace/listings',asyncRoute(async(req,res)=>{
 const rows=await Listing.find({status:'Published'}).sort({createdAt:-1}).limit(100);
 res.json({items:rows.map(clean)});
}));
router.get('/marketplace/listings/:id',asyncRoute(async(req,res)=>{
 const row=await Listing.findOne({id:req.params.id,status:'Published'});
 if(!row)return res.status(404).json({message:'Listing not found'});
 res.json({data:clean(row)});
}));
export default router;
