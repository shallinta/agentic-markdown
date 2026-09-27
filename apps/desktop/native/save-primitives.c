// macOS-only, fixed Node-API ABI. No arbitrary symbols or script execution.
#include <node_api.h>
#include <copyfile.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <string.h>
#include <math.h>
#include <stdio.h>
#include <sys/stat.h>
#include <sys/mount.h>

// 0 writable, 1 denied, 2 cannot establish ability. No writes/probe files.
static napi_value capability(napi_env env,napi_callback_info info);

static napi_value fail(napi_env env) {
  napi_throw_error(env, "NATIVE_SAVE_FAILED", "Native file operation failed");
  return NULL;
}
static int args(napi_env env, napi_callback_info info, napi_value *v, size_t n) {
  size_t count = n + 1;
  napi_value all[5];
  if (napi_get_cb_info(env, info, &count, all, NULL, NULL) != napi_ok || count != n) return 0;
  for (size_t i=0; i<n; i++) v[i]=all[i];
  return 1;
}
static int integer(napi_env env, napi_value v, int *out) {
  double x;
  if (napi_get_value_double(env,v,&x)!=napi_ok || !isfinite(x) || x<0 || x>2147483647 || (double)(int)x!=x) return 0;
  *out=(int)x; return 1;
}
static int name(napi_env env,napi_value v,char *out) {
  size_t len;
  if(napi_get_value_string_utf8(env,v,NULL,0,&len)!=napi_ok || len==0 || len>255) return 0;
  if(napi_get_value_string_utf8(env,v,out,256,&len)!=napi_ok) return 0;
  return strlen(out)==len && !strchr(out,'/') && strcmp(out,".") && strcmp(out,"..");
}
static napi_value number(napi_env env,int value) { napi_value out; napi_create_int32(env,value,&out);return out; }
static napi_value create(napi_env env,napi_callback_info info) {
  napi_value v[2];int fd;char leaf[256];
  if(!args(env,info,v,2)||!integer(env,v[0],&fd)||!name(env,v[1],leaf)) return fail(env);
  if(strncmp(leaf,".agentic-save-",14)!=0) return fail(env);
  int result=openat(fd,leaf,O_RDWR|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600);
  return result<0?fail(env):number(env,result);
}
static napi_value metadata(napi_env env,napi_callback_info info) {
  napi_value v[2];int src,dst;
  if(!args(env,info,v,2)||!integer(env,v[0],&src)||!integer(env,v[1],&dst)) return fail(env);
  if(fcopyfile(src,dst,NULL,COPYFILE_METADATA)!=0) return fail(env);
  return number(env,0);
}
static napi_value sync_full(napi_env env,napi_callback_info info) {
  napi_value v[1];int fd;
  if(!args(env,info,v,1)||!integer(env,v[0],&fd)) return fail(env);
  if(fsync(fd)!=0 || fcntl(fd,F_FULLFSYNC)!=0) return fail(env);
  return number(env,0);
}
static napi_value replace(napi_env env,napi_callback_info info) {
  napi_value v[3];int fd;char src[256],dst[256];
  if(!args(env,info,v,3)||!integer(env,v[0],&fd)||!name(env,v[1],src)||!name(env,v[2],dst)) return fail(env);
  if(renameat(fd,src,fd,dst)!=0) return fail(env);
  return number(env,0);
}
static napi_value remove_temp(napi_env env,napi_callback_info info) {
  napi_value v[2];int fd;char leaf[256];
  if(!args(env,info,v,2)||!integer(env,v[0],&fd)||!name(env,v[1],leaf)) return fail(env);
  if(strncmp(leaf,".agentic-save-",14)!=0) return fail(env);
  if(unlinkat(fd,leaf,0)!=0 && errno!=ENOENT) return fail(env);
  return number(env,0);
}
static napi_value capability(napi_env env,napi_callback_info info) {
  napi_value v[3];int dirfd,filefd;char leaf[256];
  if(!args(env,info,v,3)||!integer(env,v[0],&dirfd)||!integer(env,v[1],&filefd)||!name(env,v[2],leaf)) return fail(env);
  struct stat file,dir,current;struct statfs fs;
  if(fstat(filefd,&file)||fstat(dirfd,&dir)||fstatat(dirfd,leaf,&current,AT_SYMLINK_NOFOLLOW)||fstatfs(dirfd,&fs)) return number(env,2);
  if(!S_ISREG(file.st_mode)||!S_ISDIR(dir.st_mode)||file.st_dev!=current.st_dev||file.st_ino!=current.st_ino||file.st_nlink!=1) return number(env,2);
  unsigned int blocked=UF_IMMUTABLE|SF_IMMUTABLE|UF_APPEND|SF_APPEND;
  if((file.st_flags&blocked)||(dir.st_flags&blocked)||(fs.f_flags&MNT_RDONLY)||!(file.st_mode&0222)) return number(env,1);
  if(faccessat(dirfd,leaf,_WRITE_OK|_DELETE_OK,AT_EACCESS|AT_SYMLINK_NOFOLLOW)||faccessat(dirfd,".",_WRITE_OK|_EXECUTE_OK,AT_EACCESS))
    return number(env,(errno==EACCES||errno==EPERM||errno==EROFS)?1:2);
  return number(env,0);
}
static napi_value init(napi_env env,napi_value exports) {
  napi_property_descriptor properties[]={
    {"createTemp",NULL,create,NULL,NULL,NULL,napi_default,NULL},
    {"copyMetadata",NULL,metadata,NULL,NULL,NULL,napi_default,NULL},
    {"fullSync",NULL,sync_full,NULL,NULL,NULL,napi_default,NULL},
    {"replace",NULL,replace,NULL,NULL,NULL,napi_default,NULL},
    {"removeTemp",NULL,remove_temp,NULL,NULL,NULL,napi_default,NULL},
    {"writeCapability",NULL,capability,NULL,NULL,NULL,napi_default,NULL}
  };
  napi_define_properties(env,exports,6,properties);return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME,init)
