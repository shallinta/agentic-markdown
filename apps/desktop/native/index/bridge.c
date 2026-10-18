#include <node_api.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <math.h>
#include "index_bridge_v1.h"
_Static_assert(sizeof(uint32_t)==4,"u32");
_Static_assert(sizeof(uint64_t)==8,"u64");
#define OUTPUT 150000
typedef struct State State;
typedef struct Handle {State *state; IndexSession *rust; struct Handle *next; bool closed;} Handle;
struct State {napi_env env; Handle *handles; size_t refs,allocated,freed,closed;
  bool cleanup,hook_registered,hook_ref;
#ifdef INDEX_BRIDGE_TEST
 FILE *audit;
#endif
};
static const napi_type_tag TAG={0x706ad9a24dd14e21ULL,0xb88049fa7bef73c6ULL};

static napi_value fail(napi_env e,const char *code){
  bool pending=false;napi_is_exception_pending(e,&pending);
  if(!pending)napi_throw_error(e,code,"INDEX_BRIDGE");return NULL;
}
#ifdef INDEX_BRIDGE_TEST
static void audit(State *s,const char *event){if(s->audit){
  fprintf(s->audit,"%s %zu %zu %zu\n",event,s->allocated,s->closed,s->freed);fflush(s->audit);}}
#else
static void audit(State *s,const char *event){(void)s;(void)event;}
#endif
static void release(State *s){if(--s->refs==0){audit(s,"state-free");
#ifdef INDEX_BRIDGE_TEST
if(s->audit)fclose(s->audit);
#endif
free(s);}}
static uint32_t close_handle(Handle *h){if(h->closed)return IDX_CLOSED;
  IndexSession *p=h->rust;h->rust=NULL;h->closed=true;h->state->closed++;
  uint32_t result=index_close(p);audit(h->state,"close");return result;}
static void cleanup_resources(State*s){if(s->cleanup)return;s->cleanup=true;
  for(Handle*h=s->handles;h;h=h->next)close_handle(h);audit(s,"cleanup");}
static void cleanup(void *data){State*s=data;s->hook_registered=false;cleanup_resources(s);
  if(s->hook_ref){s->hook_ref=false;release(s);}}
static void finalize_handle(napi_env env,void *data,void *hint){
  (void)env;(void)hint;Handle*h=data;State*s=h->state;close_handle(h);
  Handle**link=&s->handles;while(*link&&*link!=h)link=&(*link)->next;
  if(*link==h)*link=h->next;s->freed++;audit(s,"finalize");free(h);release(s);
}
static void finalize_state(napi_env env,void *data,void *hint){
  (void)hint;State*s=data;
  if(s->hook_registered){if(napi_remove_env_cleanup_hook(env,cleanup,s)==napi_ok){s->hook_registered=false;cleanup(s);}
    else cleanup_resources(s); /* Registered hook retains its own reference on failure. */}
  else cleanup_resources(s);
  release(s); // wrappers and any still-registered hook retain independent references.
}
static State*state(napi_env e){State*s=NULL;if(napi_get_instance_data(e,(void**)&s)!=napi_ok)return NULL;return s;}
static Handle*handle(napi_env e,napi_value value,State*s){
  bool tagged=false;if(napi_check_object_type_tag(e,value,&TAG,&tagged)!=napi_ok||!tagged)return NULL;
  Handle*h=NULL;if(napi_unwrap(e,value,(void**)&h)!=napi_ok||!h||h->state!=s||s->env!=e)return NULL;return h;
}
static bool u32(napi_env e,napi_value v,uint32_t*out){double n;
  if(napi_get_value_double(e,v,&n)!=napi_ok||!isfinite(n)||n<0||n>4294967295.0)return false;
  uint32_t result=(uint32_t)n;if((double)result!=n)return false;*out=result;return true;}
static bool buffer(napi_env e,napi_value v,void**p,size_t*n){bool b=false;
  return napi_is_buffer(e,v,&b)==napi_ok&&b&&napi_get_buffer_info(e,v,p,n)==napi_ok;}
static bool overlap(void*a,size_t an,void*b,size_t bn){
  if(!an||!bn)return false;uintptr_t x=(uintptr_t)a,y=(uintptr_t)b;
  return x<=y ? y-x<an : x-y<bn;
}
static napi_value number(napi_env e,uint32_t n){napi_value v;
  if(napi_create_uint32(e,n,&v)!=napi_ok)return fail(e,"NAPI_RESULT");return v;}

static napi_value version(napi_env e,napi_callback_info info){(void)info;return number(e,index_abi_version());}
static napi_value open_index(napi_env e,napi_callback_info info){
  State*s=state(e);size_t argc=4;napi_value args[4];uint32_t mode;void*data,*metadata;size_t len,mlen;
  if(!s||s->cleanup)return fail(e,"CLOSED_ENV");
  if(napi_get_cb_info(e,info,&argc,args,NULL,NULL)!=napi_ok||argc!=3||!buffer(e,args[2],&metadata,&mlen)||mlen!=8||!u32(e,args[1],&mode)||!buffer(e,args[0],&data,&len)||len==0||len>4096)return fail(e,"INPUT");
  napi_value object;if(napi_create_object(e,&object)!=napi_ok)return fail(e,"ALLOC");
  Handle*h=calloc(1,sizeof(*h));if(!h)return fail(e,"ALLOC");h->state=s;
  if(overlap(data,len,metadata,mlen)){free(h);return fail(e,"OVERLAP");}
  uint64_t generation=0;uint32_t code=index_open(data,len,mode,&h->rust,&generation);
  for(size_t b=0;b<8;b++)((uint8_t*)metadata)[b]=(uint8_t)(generation>>(b*8));if(code!=0){free(h);return number(e,code);}
  if(napi_type_tag_object(e,object,&TAG)!=napi_ok){index_close(h->rust);free(h);return fail(e,"TAG");}
  h->next=s->handles;s->handles=h;s->refs++;s->allocated++;
  if(napi_wrap(e,object,h,finalize_handle,NULL,NULL)!=napi_ok){s->handles=h->next;close_handle(h);s->freed++;free(h);release(s);return fail(e,"WRAP");}
  audit(s,"open");return object;
}
static napi_value call_index(napi_env e,napi_callback_info info){
  State*s=state(e);size_t argc=6;napi_value args[6];uint32_t op;void*input,*output,*metadata;size_t len,cap,mlen;
  if(!s||s->cleanup)return fail(e,"CLOSED_ENV");
  if(napi_get_cb_info(e,info,&argc,args,NULL,NULL)!=napi_ok||argc!=5||!u32(e,args[1],&op)||
     !buffer(e,args[2],&input,&len)||len>70000||!buffer(e,args[3],&output,&cap)||cap>OUTPUT||
     !buffer(e,args[4],&metadata,&mlen)||mlen!=32)return fail(e,"INPUT");
  Handle*h=handle(e,args[0],s);if(!h)return fail(e,"HANDLE");if(h->closed)return number(e,IDX_CLOSED);
  if(overlap(input,len,output,cap)||overlap(input,len,metadata,mlen)||overlap(output,cap,metadata,mlen))return fail(e,"OVERLAP");
  // No alignment assumption about JS buffers; native metadata uses local aligned POD.
  uint64_t facts[4]={0};napi_value codes[9];
  for(uint32_t i=0;i<9;i++)if(napi_create_uint32(e,i,&codes[i])!=napi_ok)return fail(e,"RESULT_PREALLOC");
  uint32_t code=index_call(h->rust,op,input,len,output,cap,facts);
  // Facts copied before any subsequent Node-API interaction; caller owns this buffer.
  for(size_t i=0;i<4;i++)for(size_t b=0;b<8;b++)((uint8_t*)metadata)[i*8+b]=(uint8_t)(facts[i]>>(b*8));
  if(code>8)return fail(e,"NATIVE_STATUS");return codes[code];
}
static napi_value close_index(napi_env e,napi_callback_info info){
  State*s=state(e);size_t argc=2;napi_value args[2];
  if(!s||napi_get_cb_info(e,info,&argc,args,NULL,NULL)!=napi_ok||argc!=1)return fail(e,"INPUT");
  Handle*h=handle(e,args[0],s);if(!h)return fail(e,"HANDLE");napi_value codes[9];
  for(uint32_t i=0;i<9;i++)if(napi_create_uint32(e,i,&codes[i])!=napi_ok)return fail(e,"CLOSE_PREALLOC");
  uint32_t code=close_handle(h);if(code>8)return fail(e,"CLOSE_STATUS");return codes[code];
}
#ifdef INDEX_BRIDGE_TEST
static napi_value set_audit(napi_env e,napi_callback_info info){
  State*s=state(e);size_t argc=2;napi_value args[2];void*p;size_t n;
  if(!s||s->audit||s->allocated||napi_get_cb_info(e,info,&argc,args,NULL,NULL)!=napi_ok||argc!=1||!buffer(e,args[0],&p,&n)||n==0||n>4096||memchr(p,0,n))return fail(e,"AUDIT_INPUT");
  char path[4097];memcpy(path,p,n);path[n]=0;s->audit=fopen(path,"wx");if(!s->audit)return fail(e,"AUDIT_OPEN");return number(e,0);
}
static napi_value cleanup_test(napi_env e,napi_callback_info info){
  (void)info;State*s=state(e);if(!s)return fail(e,"STATE");
  if(s->hook_registered){if(napi_remove_env_cleanup_hook(e,cleanup,s)!=napi_ok)return fail(e,"HOOK");s->hook_registered=false;}
  cleanup(s);return number(e,0);
}
static napi_value stats(napi_env e,napi_callback_info info){(void)info;State*s=state(e);if(!s)return fail(e,"STATE");
  napi_value out,a,c,f;if(napi_create_object(e,&out)!=napi_ok||napi_create_uint32(e,s->allocated,&a)!=napi_ok||napi_create_uint32(e,s->closed,&c)!=napi_ok||napi_create_uint32(e,s->freed,&f)!=napi_ok)return fail(e,"STATS");
  if(napi_set_named_property(e,out,"allocated",a)!=napi_ok||napi_set_named_property(e,out,"closed",c)!=napi_ok||napi_set_named_property(e,out,"freed",f)!=napi_ok)return fail(e,"STATS");return out;
}
#endif
static napi_value initialize(napi_env e,napi_value exports){
  State*s=calloc(1,sizeof(*s));if(!s)return fail(e,"ALLOC");s->env=e;s->refs=1;
  if(napi_set_instance_data(e,s,finalize_state,NULL)!=napi_ok){free(s);return fail(e,"INSTANCE");}
  if(napi_add_env_cleanup_hook(e,cleanup,s)!=napi_ok)return fail(e,"HOOK");s->hook_registered=true;s->hook_ref=true;s->refs++;
  napi_property_descriptor methods[]={
    {"version",NULL,version,NULL,NULL,NULL,napi_default,NULL},{"open",NULL,open_index,NULL,NULL,NULL,napi_default,NULL},
    {"call",NULL,call_index,NULL,NULL,NULL,napi_default,NULL},{"close",NULL,close_index,NULL,NULL,NULL,napi_default,NULL},
    #ifdef INDEX_BRIDGE_TEST
    {"audit",NULL,set_audit,NULL,NULL,NULL,napi_default,NULL},{"cleanupForTest",NULL,cleanup_test,NULL,NULL,NULL,napi_default,NULL},
    {"stats",NULL,stats,NULL,NULL,NULL,napi_default,NULL},
#endif
  };
  if(napi_define_properties(e,exports,sizeof(methods)/sizeof(methods[0]),methods)!=napi_ok)return fail(e,"EXPORTS");return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME,initialize)
