// Included by save-primitives.c. Only trusted backend callers supply directory
// descriptors already validated by the root capability/identity-chain walk.
#include <sys/event.h>
#include <stdint.h>

#define WATCH_MAX_FDS 512
#define WATCH_MAX_INSTANCES 8
#define WATCH_MAX_EVENTS 128
#define WATCH_MAX_ID 9007199254740991ULL

typedef struct watch_instance watch_instance;
typedef struct {
  napi_env env;
  watch_instance *head;
  uint64_t serial;
  unsigned descriptors, instances, references;
  bool closing;
} watch_environment;
typedef struct { int fd; uint64_t id; } watch_entry;
struct watch_instance {
  watch_environment *owner;
  watch_instance *previous, *next;
  int queue;
  unsigned capacity, count;
  watch_entry entries[];
};
static const napi_type_tag watch_tag={0x5b90a15d26974d52ULL,0x98af22a31bb8fa35ULL};

static void watch_environment_release(watch_environment *owner) {
  if(!--owner->references) free(owner);
}
static void watch_destroy(watch_instance *instance) {
  if(instance->queue<0) return;
  // Closing the private queue first prevents stale kernel events from surviving
  // descriptor-number reuse. No registration is ever reopened by pathname.
  close(instance->queue); instance->queue=-1;
  for(unsigned i=0;i<instance->capacity;i++) if(instance->entries[i].id) {
    close(instance->entries[i].fd);
    instance->entries[i].id=0;
    instance->owner->descriptors--;
  }
  instance->count=0;
  instance->owner->instances--;
}
static void watch_finalize(napi_env env,void *data,void *hint) {
  (void)env; (void)hint;
  watch_instance *instance=data;
  watch_environment *owner=instance->owner;
  watch_destroy(instance);
  if(instance->previous) instance->previous->next=instance->next;
  else owner->head=instance->next;
  if(instance->next) instance->next->previous=instance->previous;
  free(instance);
  watch_environment_release(owner);
}
static void watch_environment_cleanup(void *data) {
  watch_environment *owner=data;
  owner->closing=true;
  for(watch_instance *item=owner->head;item;item=item->next) watch_destroy(item);
  // Wrappers may finalize before or after the environment cleanup hook. Their
  // references keep this private owner alive in either ordering.
  watch_environment_release(owner);
}
static int watch_value(napi_env env,napi_value value,watch_instance **out) {
  bool matches=false;
  return napi_check_object_type_tag(env,value,&watch_tag,&matches)==napi_ok && matches &&
    napi_unwrap(env,value,(void**)out)==napi_ok && *out && (*out)->owner->env==env;
}
static int watch_id(napi_env env,napi_value value,uint64_t *id) {
  double number;
  if(napi_get_value_double(env,value,&number)!=napi_ok || !isfinite(number) ||
     number<1 || number>(double)WATCH_MAX_ID || floor(number)!=number) return 0;
  *id=(uint64_t)number; return 1;
}
static napi_value watch_number(napi_env env,uint64_t id) {
  napi_value out;
  return napi_create_double(env,(double)id,&out)==napi_ok?out:fail(env);
}
static napi_value watch_create(napi_env env,napi_callback_info info) {
  napi_value value[1],out;
  int capacity;
  void *data=NULL; size_t unused=0;
  if(!args(env,info,value,1) || !integer(env,value[0],&capacity) || capacity<1 || capacity>WATCH_MAX_FDS ||
     napi_get_cb_info(env,info,&unused,NULL,NULL,&data)!=napi_ok || !data) return fail(env);
  watch_environment *owner=data;
  if(owner->closing || owner->instances>=WATCH_MAX_INSTANCES) return fail(env);
  watch_instance *instance=calloc(1,sizeof(*instance)+(size_t)capacity*sizeof(watch_entry));
  if(!instance) return fail(env);
  instance->owner=owner; instance->capacity=(unsigned)capacity;
  instance->queue=kqueue();
  if(instance->queue<0) {free(instance);return fail(env);}
  if(fcntl(instance->queue,F_SETFD,FD_CLOEXEC)<0) {close(instance->queue);free(instance);return fail(env);}
  if(napi_create_object(env,&out)!=napi_ok || napi_type_tag_object(env,out,&watch_tag)!=napi_ok ||
     napi_wrap(env,out,instance,watch_finalize,NULL,NULL)!=napi_ok) {
    close(instance->queue);free(instance);return fail(env);
  }
  instance->next=owner->head;
  if(owner->head) owner->head->previous=instance;
  owner->head=instance;
  owner->references++;owner->instances++;
  return out;
}
static napi_value watch_add(napi_env env,napi_callback_info info) {
  napi_value value[2],out; watch_instance *instance; int source; struct stat stat;
  if(!args(env,info,value,2) || !watch_value(env,value[0],&instance) || instance->queue<0 || instance->owner->closing ||
     !integer(env,value[1],&source) || instance->count>=instance->capacity ||
     instance->owner->descriptors>=WATCH_MAX_FDS || instance->owner->serial>=WATCH_MAX_ID) return fail(env);
  int owned=fcntl(source,F_DUPFD_CLOEXEC,0);
  if(owned<0) return fail(env);
  if(fstat(owned,&stat)<0 || !S_ISDIR(stat.st_mode)) {close(owned);return fail(env);}
  uint64_t id=++instance->owner->serial;
  if(napi_create_double(env,(double)id,&out)!=napi_ok) {close(owned);return fail(env);}
  struct kevent change;
  EV_SET(&change,(uintptr_t)owned,EVFILT_VNODE,EV_ADD|EV_CLEAR,
    NOTE_WRITE|NOTE_DELETE|NOTE_RENAME|NOTE_ATTRIB|NOTE_REVOKE,0,(void*)(uintptr_t)id);
  if(kevent(instance->queue,&change,1,NULL,0,NULL)<0) {close(owned);return fail(env);}
  for(unsigned i=0;i<instance->capacity;i++) if(!instance->entries[i].id) {
    instance->entries[i]=(watch_entry){owned,id};
    instance->count++;instance->owner->descriptors++;
    return out;
  }
  close(owned);return fail(env);
}
static napi_value watch_remove(napi_env env,napi_callback_info info) {
  napi_value value[2]; watch_instance *instance; uint64_t id;
  if(!args(env,info,value,2) || !watch_value(env,value[0],&instance) || !watch_id(env,value[1],&id)) return fail(env);
  for(unsigned i=0;instance->queue>=0 && i<instance->capacity;i++) if(instance->entries[i].id==id) {
    // The entry owns exactly this descriptor; id, never fd, identifies it.
    close(instance->entries[i].fd);
    instance->entries[i].id=0;
    instance->count--;instance->owner->descriptors--;
    break;
  }
  return number(env,0);
}
static napi_value watch_poll(napi_env env,napi_callback_info info) {
  napi_value value[2],out,items,saturated; watch_instance *instance; int limit;
  if(!args(env,info,value,2) || !watch_value(env,value[0],&instance) || instance->queue<0 || instance->owner->closing ||
     !integer(env,value[1],&limit) || limit<1 || limit>WATCH_MAX_EVENTS) return fail(env);
  struct kevent events[WATCH_MAX_EVENTS]; struct timespec timeout={0,0};
  int count=kevent(instance->queue,NULL,0,events,limit,&timeout);
  if(count<0) return fail(env);
  if(napi_create_array(env,&items)!=napi_ok) return fail(env);
  unsigned used=0;
  for(int i=0;i<count;i++) {
    if(events[i].flags&EV_ERROR) return fail(env);
    uint64_t id=(uint64_t)(uintptr_t)events[i].udata;
    bool active=false;
    for(unsigned j=0;j<instance->capacity;j++) if(instance->entries[j].id==id &&
      (uintptr_t)instance->entries[j].fd==events[i].ident) {active=true;break;}
    if(!active) continue;
    napi_value item,identity,flags;
    if(napi_create_object(env,&item)!=napi_ok || napi_create_double(env,(double)id,&identity)!=napi_ok ||
       napi_create_uint32(env,events[i].fflags,&flags)!=napi_ok ||
       napi_set_named_property(env,item,"id",identity)!=napi_ok || napi_set_named_property(env,item,"flags",flags)!=napi_ok ||
       napi_set_element(env,items,used++,item)!=napi_ok) return fail(env);
  }
  if(napi_create_object(env,&out)!=napi_ok || napi_get_boolean(env,count==limit,&saturated)!=napi_ok ||
     napi_set_named_property(env,out,"events",items)!=napi_ok || napi_set_named_property(env,out,"saturated",saturated)!=napi_ok) return fail(env);
  return out;
}
static napi_value watch_close(napi_env env,napi_callback_info info) {
  napi_value value[1]; watch_instance *instance;
  if(!args(env,info,value,1) || !watch_value(env,value[0],&instance)) return fail(env);
  watch_destroy(instance);return number(env,0);
}
static napi_value watch_count(napi_env env,napi_callback_info info) {
  napi_value value[1]; watch_instance *instance;
  if(!args(env,info,value,1) || !watch_value(env,value[0],&instance)) return fail(env);
  return watch_number(env,instance->count);
}
static int install_directory_watch(napi_env env,napi_value exports) {
  watch_environment *owner=calloc(1,sizeof(*owner));
  if(!owner) return 0;
  owner->env=env;owner->references=1;
  if(napi_add_env_cleanup_hook(env,watch_environment_cleanup,owner)!=napi_ok) {free(owner);return 0;}
  napi_property_descriptor properties[]={
    {"watchCreate",NULL,watch_create,NULL,NULL,NULL,napi_default,owner},
    {"watchAdd",NULL,watch_add,NULL,NULL,NULL,napi_default,NULL},
    {"watchRemove",NULL,watch_remove,NULL,NULL,NULL,napi_default,NULL},
    {"watchPoll",NULL,watch_poll,NULL,NULL,NULL,napi_default,NULL},
    {"watchClose",NULL,watch_close,NULL,NULL,NULL,napi_default,NULL},
    {"watchCount",NULL,watch_count,NULL,NULL,NULL,napi_default,NULL}
  };
  return napi_define_properties(env,exports,6,properties)==napi_ok;
}
