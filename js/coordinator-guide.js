import {requireAdmin} from './auth.js';
import {mountOperationalSidebar} from './operational-sidebar.js';
const status=document.getElementById('guide-auth-status');
async function init(){
 const session=await requireAdmin({redirectTo:'./'});
 if(!session.allowed)return;
 await mountOperationalSidebar({active:'',role:session.admin?.ruolo,admin:session.admin});
 document.body.classList.remove('auth-pending');
 document.getElementById('guide-print')?.addEventListener('click',()=>window.print());
 status?.remove();
}
init().catch(error=>{
 if(status)status.textContent='Non è stato possibile verificare i permessi: '+error.message;
});
