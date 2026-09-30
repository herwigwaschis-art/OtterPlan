/* Shared-device boundary. No pupil data is stored here. Load before external resources. */
(function(){
 'use strict';
 var u=new URL(location.href),fragment=new URLSearchParams(u.hash.slice(1));
 var childToken=fragment.get('child')||u.searchParams.get('child')||'';
 if(childToken){u.searchParams.delete('child');if(fragment.has('child'))u.hash='';window.history.replaceState({},'',u.pathname+u.search+u.hash);}
 var epoch=0,controllers=new Set();
 // Move an existing login into tab-scoped storage without exposing its value.
 try{var key='sb-vcjzkyzarmxkxdwrsqjq-auth-token',legacy=localStorage.getItem(key);
  if(legacy&&!sessionStorage.getItem(key))sessionStorage.setItem(key,legacy);
  localStorage.removeItem(key);
  legacy=null;
 }catch(e){}
 window.MILO_SECURITY={
  takeChildToken:function(){var token=childToken;childToken='';return token},
  fetch:async function(input,init){
   var started=epoch,controller=new AbortController(),external=init&&init.signal;
   function abort(){controller.abort()}
   if(external){if(external.aborted)abort();else external.addEventListener('abort',abort,{once:true});}
   controllers.add(controller);
   try{var result=await fetch(input,Object.assign({},init,{signal:controller.signal}));
    if(started!==epoch)throw new DOMException('Sitzung beendet','AbortError');
    var readJson=result.json.bind(result);result.json=async function(){var data=await readJson();if(started!==epoch)throw new DOMException('Sitzung beendet','AbortError');return data};
    return result;
   }finally{controllers.delete(controller);if(external)external.removeEventListener('abort',abort);}
  },
  invalidate:function(){epoch++;controllers.forEach(function(c){c.abort()});controllers.clear()},
  clearStoredSession:function(){
   ['localStorage','sessionStorage'].forEach(function(kind){try{var storage=window[kind];Object.keys(storage).filter(function(k){return k==='sb-vcjzkyzarmxkxdwrsqjq-auth-token'||k.indexOf('otter_admin_')===0}).forEach(function(k){storage.removeItem(k)})}catch(e){}});
  }
 };
})();
