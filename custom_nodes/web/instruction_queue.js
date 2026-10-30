// Resolve fresh credentials through Comfy's own initialized auth stores. A plain
// api.queuePrompt call does not do this: ComfyApp normally attaches them only for
// the duration of its own queue operation. Never cache credentials on the node.
function stores(api,app){
 const registry=app.extensionManager?._p?._s;
 return {auth:registry?.get('auth'),key:registry?.get('apiKeyAuth'),workspace:registry?.get('teamWorkspace')};
}
const identity=s=>s.auth?.currentUser?.uid??(s.key?.isAuthenticated?'api-key':null);
export async function queueCameraJob(api,app,graph,requestId,signal){
 const checkStop=()=>{if(signal?.aborted)throw new Error('Stopped. No camera changes were applied.');};
 await api.waitForAuthInitialization?.();checkStop();
 let session=stores(api,app);
 // Newer Comfy builds may expose the auth store directly. Keep the installed
 // local-build compatibility lookup in this module rather than importing hashes.
 if(!session.auth)session.auth=await api.getAuthStore?.();
 const credentials=async()=>{
  checkStop();await session.workspace?.waitForWorkspaceSwitch?.();checkStop();
  const who=identity(session),workspace=session.workspace?.activeWorkspaceId,epoch=session.workspace?.workspaceTransitionGeneration;
  const token=session.auth?.getWorkspaceAuthToken?await session.auth.getWorkspaceAuthToken():session.auth?.getAuthToken?await session.auth.getAuthToken():api.authToken;
  const key=session.key?.getApiKey?.()??api.apiKey;
  checkStop();
  if(who!==identity(session)||workspace!=null&&(workspace!==session.workspace?.activeWorkspaceId||epoch!==session.workspace?.workspaceTransitionGeneration))throw new Error('The Comfy account or workspace changed. Submit the camera job again.');
  return {token,key};
 };
 let auth=await credentials();
 if(!auth.token&&!auth.key){
  const dialog=app.extensionManager?.dialog;
  if(!dialog?.showApiNodesSignInDialog)throw new Error('Sign in to Comfy from its account menu, then submit the camera job again.');
  const models=[...new Set(Object.values(graph).filter(n=>n.class_type!=='CartwheelCameraInstructionResult'&&n.class_type!=='OpenAIChatConfig').map(n=>n.class_type))];
  if(!await dialog.showApiNodesSignInDialog(models))throw new Error('Sign-in cancelled. No camera job was sent.');
  checkStop();session=stores(api,app);if(!session.auth)session.auth=await api.getAuthStore?.();auth=await credentials();
  if(!auth.token&&!auth.key)throw new Error('Comfy did not provide an authenticated session. Sign in using the same account and login method used for Seedance/H3, then try again.');
 }
 checkStop();
 const workflow={id:requestId,version:0.4,nodes:[],links:[],groups:[],config:{},extra:{cartwheel_camera_instruction:true}};
 // Same hidden fields and /prompt endpoint used by ComfyApi.queuePrompt, without
 // mutating its shared authToken/apiKey properties or affecting another queue.
 const response=await api.fetchApi('/prompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id:api.clientId??'',prompt:graph,extra_data:{auth_token_comfy_org:auth.token,api_key_comfy_org:auth.key,comfy_usage_source:'comfyui-frontend',extra_pnginfo:{workflow}}})});
 const result=await response.json();
 if(!response.ok){const issue=result.error;throw new Error(typeof issue==='string'?issue:issue?.message??result.message??`Comfy rejected the camera job (${response.status}).`);}
 return result;
}
