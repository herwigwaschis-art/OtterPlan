import {chromium} from '@playwright/test';import assert from 'node:assert/strict';import fs from 'node:fs';
const browser=await chromium.launch({executablePath:process.env.MILO_BROWSER_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
const results=[];
try{
 for(const size of [{name:'desktop',width:1440,height:1000},{name:'ipad-portrait',width:820,height:1180},{name:'ipad-landscape',width:1180,height:820}]){
  const context=await browser.newContext({viewport:{width:size.width,height:size.height},serviceWorkers:'block'}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:4173');await page.waitForFunction(()=>!!window.__miloTest);
  assert.equal(await page.locator('#login').evaluate(n=>n.classList.contains('active')),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.equal(await page.evaluate(()=>window.__authOptions.storage===sessionStorage),true);
  const urls=await page.evaluate(()=>{let u=__miloTest.url('synthetic-token');return{u,n:__miloTest.norm(u),legacy:__miloTest.norm(location.origin+location.pathname+'?child=legacy')}});
  assert.equal(new URL(urls.u).search,'');assert.equal(new URL(urls.u).hash,'#child=synthetic-token');assert.equal(urls.n,'synthetic-token');assert.equal(urls.legacy,'legacy');
  await page.evaluate(()=>{
   __miloTest.setState({user:{id:'test'},role:'teacher',plans:[{goal:'SECRET-GOAL'}],developmentData:{note:'SECRET-NOTE'},previewStudent:{display_name:'SECRET-CHILD'}});
   document.querySelector('#planObsText').value='SECRET-NOTE';document.querySelector('#teacherQr').dataset.token='SECRET-QR';document.querySelector('#qrName').textContent='SECRET-CHILD';
   document.querySelector('#password').value='SECRET-PASSWORD';sessionStorage.setItem('otter_admin_test','1');
  });
  await page.evaluate(()=>APP.logout());
  const clean=await page.evaluate(()=>({state:JSON.stringify(__miloTest.state()),dom:document.body.innerHTML,values:[...document.querySelectorAll('input,textarea')].map(n=>n.value).join(''),admin:sessionStorage.getItem('otter_admin_test'),role:__miloTest.state().role}));
  assert.equal(/SECRET/.test(clean.state+clean.dom+clean.values),false);assert.equal(clean.admin,null);assert.equal(clean.role,null);
  await page.evaluate(()=>{__miloTest.setState({user:{id:'test'},role:'teacher',developmentData:{note:'SECRET-EXPIRED'}});document.querySelector('#planObsText').value='SECRET-EXPIRED';window.__signOut('SIGNED_OUT',null)});
  assert.equal(await page.evaluate(()=>JSON.stringify(__miloTest.state()).includes('SECRET')||document.querySelector('#planObsText').value.includes('SECRET')),false);
  assert.equal(await page.locator('.voice-btn').first().isVisible(),false);
  await page.evaluate(()=>{window.SpeechRecognition=function(){throw Error('Must not start speech')};APP.dictateObservation('planObsText');APP.speakGoal()});
  assert.deepEqual(errors,[]);
  fs.mkdirSync(new URL('../test-results/',import.meta.url),{recursive:true});await page.screenshot({path:new URL('../test-results/'+size.name+'.png',import.meta.url).pathname});
  results.push({viewport:size.name,login:true,noOverflow:true,logoutClean:true,expiredSessionClean:true,qrFragment:true,speechDisabled:true,pageErrors:errors});await context.close();
 }
 const page=await browser.newPage();await page.goto('http://127.0.0.1:4173/#child=synthetic-only');await page.waitForFunction(()=>!!window.__miloTest);assert.equal(new URL(page.url()).hash,'');
 assert.equal(new URL(page.url()).search,'');results.push({earlyQrScrubbing:true});
 console.log(JSON.stringify(results,null,2));fs.writeFileSync(new URL('../test-results/browser.json',import.meta.url),JSON.stringify(results,null,2));
}finally{await browser.close()}
