// Local synthetic preview. Never forwards authentication or writes to Supabase.
import http from 'node:http';import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(new URL('../',import.meta.url).pathname);
const mock=`
window.__calls=[];window.__signOut=null;
var TEST_USER={id:'00000000-0000-4000-8000-000000000001',email:'test@example.invalid',is_anonymous:false};
var sbMock={auth:{getSession:async()=>({data:{session:null}}),getUser:async()=>({data:{user:TEST_USER}}),onAuthStateChange:fn=>window.__signOut=fn,signOut:async()=>{window.__signOut('SIGNED_OUT',null);return{}},signInWithPassword:async()=>({error:{message:'Synthetic login only'}}),signInAnonymously:async()=>({error:{message:'Synthetic preview, no signup'}})},from:table=>{
 var result={data:[],error:null};var q=new Proxy({}, {get:(_,key)=>key==='then'?(resolve)=>Promise.resolve(result).then(resolve):(...args)=>{window.__calls.push({table,method:key,args});return q}});return q;
},rpc:async()=>({data:[],error:null}),removeChannel:()=>{},channel:()=>({on(){return this},subscribe(){return this}})};
window.supabase={createClient:(url,key,options)=>{window.__authOptions=options.auth;return sbMock}};
`;
http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(pathname==='/test/mock.js'){res.setHeader('Content-Type','application/javascript');res.end(mock);return}
 let relative=pathname==='/'?'index.html':pathname.slice(1);
 if(!/^[a-zA-Z0-9_.-]+$/.test(relative)||!['.html','.js','.svg','.png','.webmanifest'].includes(path.extname(relative))){res.writeHead(404).end();return}
 const file=path.join(root,relative);if(!fs.existsSync(file)){res.writeHead(404).end();return}
 let body=fs.readFileSync(file);
 if(relative==='index.html'){body=body.toString().replace(/<script src="https:[^"]+"><\/script>/g,(tag)=>tag.includes('supabase')?'<script src="/test/mock.js"></script>':'').replace(/<link[^>]+https:[^>]+>/g,'');
 body=body.replace('window.APP={','window.__miloTest={state:()=>S,setState:x=>Object.assign(S,x),clear:clearPrivateSession,url:childAccessUrl,norm:norm,queue:()=>({ratings:memoryRatings,notes:memoryNotes}),loadTemplates:loadNoteTemplates};\nwindow.APP={');
 }
 res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'})[path.extname(relative)]);res.setHeader('Cache-Control','no-store');res.end(body);
}).listen(4173,'127.0.0.1',()=>console.log('Synthetic MILO preview http://127.0.0.1:4173'));
