// Optional online-only assistant: never block or weaken the offline USB workspace.
// This page deliberately permits local offline operations without a live Supabase session.
import {getCurrentUser,getAdminProfile} from './auth.js';
import {initAdminJotformAssistant} from './jotform-admin-assistant.js?v=20261021';
try {
 if(navigator.onLine && !window.ITSOSCUP_DESKTOP){
  const user=await getCurrentUser();
  if(user){
   const admin=await getAdminProfile(user.id);
   if(['super_admin','match_manager','report_viewer'].includes(admin?.ruolo))
    initAdminJotformAssistant();
  }
 }
} catch {
 // Offline and expired sessions remain functional; an unauthenticated
 // workspace must not load any third-party Jotform script.
}
