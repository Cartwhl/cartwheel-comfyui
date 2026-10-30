import assert from 'node:assert/strict';
import {queueCameraJob} from '../web/instruction_queue.js';
const graph={model:{class_type:'OpenAIChatNode',inputs:{model:'test'}},result:{class_type:'CartwheelCameraInstructionResult',inputs:{}}};
function fixture(){
 let sent=[],dialogCalls=0,tokenCalls=0;
 const auth={currentUser:{uid:'test-user'},getWorkspaceAuthToken:async()=>{tokenCalls++;return 'synthetic-workspace-token';}};
 const key={isAuthenticated:false,getApiKey:()=>undefined};
 const workspace={activeWorkspaceId:'test-workspace',workspaceTransitionGeneration:0,waitForWorkspaceSwitch:async()=>{}};
 const registry=new Map([['auth',auth],['apiKeyAuth',key],['teamWorkspace',workspace]]);
 const dialog={showApiNodesSignInDialog:async()=>{dialogCalls++;return false;}};
 const app={extensionManager:{_p:{_s:registry},dialog}};
 const api={clientId:'browser-client',fetchApi:async(path,options)=>{sent.push({path,body:JSON.parse(options.body)});return {ok:true,status:200,json:async()=>({prompt_id:'queued-camera-job'})};}};
 return {api,app,auth,key,workspace,registry,dialog,sent,get dialogs(){return dialogCalls;},get tokens(){return tokenCalls;}};
}
{
 const f=fixture();await queueCameraJob(f.api,f.app,graph,'request-1');assert.equal(f.dialogs,0);assert.equal(f.tokens,1);assert.equal(f.sent.length,1);assert.equal(f.sent[0].path,'/prompt');assert.equal(f.sent[0].body.extra_data.auth_token_comfy_org,'synthetic-workspace-token');assert.equal(f.sent[0].body.client_id,'browser-client');assert.equal(f.api.authToken,undefined);assert.equal(f.api.apiKey,undefined);assert.deepEqual(f.sent[0].body.prompt,graph);
 f.auth.getWorkspaceAuthToken=async()=> 'refreshed-synthetic-token';await queueCameraJob(f.api,f.app,graph,'request-2');assert.equal(f.sent[1].body.extra_data.auth_token_comfy_org,'refreshed-synthetic-token');
}
{
 const f=fixture();f.auth.currentUser=null;f.auth.getWorkspaceAuthToken=async()=>undefined;f.key.isAuthenticated=true;f.key.getApiKey=()=> 'synthetic-account-api-key';await queueCameraJob(f.api,f.app,graph,'api-key');assert.equal(f.dialogs,0);assert.equal(f.sent[0].body.extra_data.api_key_comfy_org,'synthetic-account-api-key');assert.equal(f.api.apiKey,undefined);
}
{
 const f=fixture();f.auth.currentUser=null;f.auth.getWorkspaceAuthToken=async()=>undefined;await assert.rejects(queueCameraJob(f.api,f.app,graph,'cancel'),/Sign-in cancelled/);assert.equal(f.dialogs,1);assert.equal(f.sent.length,0);
 f.dialog.showApiNodesSignInDialog=async names=>{assert.deepEqual(names,['OpenAIChatNode']);f.auth.currentUser={uid:'signed-in-user'};f.auth.getWorkspaceAuthToken=async()=> 'new-synthetic-session';return true;};await queueCameraJob(f.api,f.app,graph,'login');assert.equal(f.sent[0].body.extra_data.auth_token_comfy_org,'new-synthetic-session');
}
{
 const f=fixture();f.auth.getWorkspaceAuthToken=async()=>{f.workspace.activeWorkspaceId='other-workspace';return 'wrong-workspace-token';};await assert.rejects(queueCameraJob(f.api,f.app,graph,'workspace-change'),/account or workspace changed/);assert.equal(f.sent.length,0);
}
{
 const f=fixture();f.auth.getWorkspaceAuthToken=async()=>{f.auth.currentUser={uid:'other-user'};return 'old-account-token';};await assert.rejects(queueCameraJob(f.api,f.app,graph,'account-change'),/account or workspace changed/);assert.equal(f.sent.length,0);
}
{
 const f=fixture(),c=new AbortController();c.abort();await assert.rejects(queueCameraJob(f.api,f.app,graph,'stopped',c.signal),/Stopped/);assert.equal(f.sent.length,0);
 f.api.fetchApi=async()=>({ok:false,status:401,json:async()=>({error:{message:'Sign in required'}})});await assert.rejects(queueCameraJob(f.api,f.app,graph,'server-error'),/Sign in required/);
}
{
 const f=fixture();f.registry.delete('auth');f.api.getAuthStore=async()=>f.auth;await queueCameraJob(f.api,f.app,graph,'public-store');assert.equal(f.sent.length,1);
}
console.log('PASS: fresh native workspace/session credentials, API-key accounts, sign-in/cancel, no shared auth mutation, account/workspace changes, abort, server errors and public-store compatibility.');
