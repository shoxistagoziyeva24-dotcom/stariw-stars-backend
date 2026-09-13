import express from 'express';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

const app=express(); app.use(express.json({limit:'32kb'}));
const PORT=Number(process.env.PORT||10000);
const API_ID=Number(process.env.TG_API_ID); const API_HASH=process.env.TG_API_HASH; const SESSION=process.env.TG_SESSION; const SECRET=process.env.STARS_BACKEND_SECRET;
if(!API_ID||!API_HASH||!SESSION||!SECRET) throw new Error('TG_API_ID, TG_API_HASH, TG_SESSION, STARS_BACKEND_SECRET kerak');
let clientPromise=null;
async function client(){if(!clientPromise)clientPromise=(async()=>{const c=new TelegramClient(new StringSession(SESSION),API_ID,API_HASH,{connectionRetries:5,useWSS:false,useIPV6:false});await c.connect();if(!(await c.checkAuthorization()))throw new Error('TG seller session avtorizatsiyadan o‘tmagan');return c;})().catch(e=>{clientPromise=null;throw e});return clientPromise;}
function auth(req,res,next){if(req.get('x-stariw-secret')!==SECRET)return res.status(401).json({ok:false,error:'Unauthorized'});next();}
function norm(v){return String(v||'').trim().replace(/^@+/,'').toLowerCase();}
function inputUser(e){return new Api.InputUser({userId:e.id,accessHash:e.accessHash});}
async function resolve(username){const c=await client();const u=norm(username);if(!u)throw new Error('Username kiriting');const e=await c.getEntity('@'+u);if(!e||e.className!=='User')throw new Error('Telegram foydalanuvchisi topilmadi');if(e.bot)throw new Error('Bot akkauntiga Stars yuborib bo‘lmaydi');if(e.deleted)throw new Error('Telegram akkaunti o‘chirilgan');if(!e.accessHash)throw new Error('Telegram foydalanuvchisini aniqlab bo‘lmadi');return e;}
async function sellerStars(){const c=await client();const s=await c.invoke(new Api.payments.GetStarsStatus({peer:new Api.InputPeerSelf()}));return Number(s?.balance?.amount??0)||0;}
async function gift(username,stars){const c=await client();const e=await resolve(username);const opts=await c.invoke(new Api.payments.GetStarsGiftOptions({userId:inputUser(e)}));const option=(opts||[]).find(x=>Number(x.stars)===stars&&!x.extended)||(opts||[]).find(x=>Number(x.stars)===stars);if(!option)throw new Error(`Telegram ${stars} Stars uchun gift variantini bermadi`);const purpose=new Api.InputStorePaymentStarsGift({userId:inputUser(e),stars:BigInt(stars),currency:option.currency,amount:BigInt(option.amount)});const invoice=new Api.InputInvoiceStars({purpose});const form=await c.invoke(new Api.payments.GetPaymentForm({invoice}));const result=await c.invoke(new Api.payments.SendStarsForm({formId:form.formId,invoice}));return {transactionId:result?.transactionId?String(result.transactionId):null};}
app.get('/health',(req,res)=>res.json({ok:true,service:'stariw-stars-backend'}));
app.post('/preflight',auth,async(req,res)=>{try{const stars=Number(req.body.stars);if(!Number.isInteger(stars)||stars<=0)return res.status(400).json({ok:false,error:'Stars miqdori noto‘g‘ri'});const bal=await sellerStars();res.json({ok:true,sellerStars:bal,ready:bal>=stars});}catch(e){res.status(502).json({ok:false,error:e.message||'Telegram ulanish xatosi'})}});
app.post('/deliver',auth,async(req,res)=>{try{const stars=Number(req.body.stars);const username=norm(req.body.username);if(!Number.isInteger(stars)||stars<=0||!username)return res.status(400).json({ok:false,error:'Buyurtma ma’lumotlari noto‘g‘ri'});const bal=await sellerStars();if(bal<stars)return res.status(409).json({ok:false,error:'Seller Stars zaxirasi yetarli emas'});const r=await gift(username,stars);res.json({ok:true,transactionId:r.transactionId});}catch(e){res.status(502).json({ok:false,error:e.message||'Stars yetkazilmadi'})}});
app.listen(PORT,()=>console.log(`[stariw] Stars backend listening on ${PORT}`));
