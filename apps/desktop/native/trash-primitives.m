#import <Foundation/Foundation.h>
#include <node_api.h>
#include <sys/stat.h>
#include <string.h>
#include <stdint.h>
#include <math.h>

// Output: uint32 stage (0 preflight, 1 dispatched, 2 platform YES, 3 verified,
// 4 platform NO), uint32 UTF-8 path length, then bounded result path bytes.
static BOOL text(napi_env env,napi_value value,char *out,size_t cap) {
  napi_valuetype type;size_t n=0,written=0;
  char16_t units[4097];size_t length=0;
  if(napi_get_value_string_utf16(env,value,NULL,0,&length)!=napi_ok||length==0||length>=4097)return NO;
  if(napi_get_value_string_utf16(env,value,units,4097,&written)!=napi_ok||written!=length)return NO;
  for(size_t i=0;i<length;i++){uint16_t u=units[i];if(u>=0xd800&&u<=0xdbff){if(++i>=length||units[i]<0xdc00||units[i]>0xdfff)return NO;}else if(u>=0xdc00&&u<=0xdfff)return NO;}
  if(napi_typeof(env,value,&type)!=napi_ok||type!=napi_string||napi_get_value_string_utf8(env,value,NULL,0,&n)!=napi_ok||n==0||n>=cap)return NO;
  if(napi_get_value_string_utf8(env,value,out,cap,&written)!=napi_ok||written!=n||strlen(out)!=n)return NO;
  return YES;
}
static NSString *proof(struct stat *s){return [NSString stringWithFormat:@"%llu:%llu:%llu",(unsigned long long)s->st_dev,(unsigned long long)s->st_ino,(unsigned long long)s->st_birthtimespec.tv_sec*1000000000ULL+(unsigned long long)s->st_birthtimespec.tv_nsec];}
static BOOL same(const char *path,NSString *expected,BOOL directory){struct stat s;if(lstat(path,&s)!=0||S_ISLNK(s.st_mode)||(directory?!S_ISDIR(s.st_mode):!S_ISREG(s.st_mode)))return NO;return [proof(&s) isEqualToString:expected];}
static BOOL ancestor(NSDictionary *a){struct stat s;return fstat([a[@"fd"] intValue],&s)==0&&S_ISDIR(s.st_mode)&&[proof(&s) isEqualToString:a[@"fingerprint"]]&&same([a[@"path"] fileSystemRepresentation],a[@"fingerprint"],YES);}
static napi_value trash(napi_env env,napi_callback_info info){
  napi_value args[7],zero,one,two;size_t argc=7;bool pending=false;void *memory=NULL;size_t bytes=0;int32_t fd=-1;double fdValue=-1;BOOL directory=NO;
  if(napi_is_exception_pending(env,&pending)!=napi_ok||pending)return NULL;
  if(napi_create_int32(env,0,&zero)!=napi_ok||napi_create_int32(env,1,&one)!=napi_ok||napi_create_int32(env,2,&two)!=napi_ok)return NULL;
  if(napi_get_cb_info(env,info,&argc,args,NULL,NULL)!=napi_ok||(argc!=5&&argc!=6))return zero;
  if(argc==6){char kind[32];if(!text(env,args[5],kind,sizeof(kind))||strcmp(kind,"directory")!=0)return zero;directory=YES;}
  char path[4097],fingerprint[201];bool array=false;uint32_t count=0;
  if(!text(env,args[0],path,sizeof(path))||path[0]!='/'||!text(env,args[1],fingerprint,sizeof(fingerprint))||napi_get_value_double(env,args[2],&fdValue)!=napi_ok||!isfinite(fdValue)||fdValue<0||fdValue>INT32_MAX||floor(fdValue)!=fdValue||napi_is_array(env,args[3],&array)!=napi_ok||!array||napi_get_array_length(env,args[3],&count)!=napi_ok||count==0||count>256||napi_get_buffer_info(env,args[4],&memory,&bytes)!=napi_ok||bytes<4105)return zero;
  fd=(int32_t)fdValue;
  uint32_t *output=(uint32_t *)memory;memset(memory,0,bytes);
  @autoreleasepool {@try {
    NSString *expected=[NSString stringWithUTF8String:fingerprint];NSMutableArray *ancestors=[NSMutableArray arrayWithCapacity:count];
    for(uint32_t i=0;i<count;i++){napi_value item,p,f,d;double descriptor;char pbuf[4097],fbuf[201];if(napi_get_element(env,args[3],i,&item)!=napi_ok||napi_get_named_property(env,item,"path",&p)!=napi_ok||napi_get_named_property(env,item,"fingerprint",&f)!=napi_ok||napi_get_named_property(env,item,"fd",&d)!=napi_ok||napi_get_value_double(env,d,&descriptor)!=napi_ok||!isfinite(descriptor)||descriptor<0||descriptor>INT32_MAX||floor(descriptor)!=descriptor||!text(env,p,pbuf,sizeof(pbuf))||!text(env,f,fbuf,sizeof(fbuf)))return zero;[ancestors addObject:@{ @"path":[NSString stringWithUTF8String:pbuf],@"fingerprint":[NSString stringWithUTF8String:fbuf],@"fd":@((int)descriptor)}];}
    if(napi_is_exception_pending(env,&pending)!=napi_ok||pending)return NULL;
    struct stat held;if(fstat(fd,&held)!=0||(directory?!S_ISDIR(held.st_mode):!S_ISREG(held.st_mode))||![proof(&held) isEqualToString:expected]||!same(path,expected,directory))return zero;
    for(NSDictionary *a in ancestors)if(!ancestor(a))return zero;
    NSURL *url=[NSURL fileURLWithPath:[NSString stringWithUTF8String:path]],*reference=[url fileReferenceURL];
    if(!reference||!reference.isFileReferenceURL||!same(reference.filePathURL.path.fileSystemRepresentation,expected,directory))return zero;
    if(!same(path,expected,directory)||fstat(fd,&held)!=0||![proof(&held) isEqualToString:expected])return zero;
    for(NSDictionary *a in ancestors)if(!ancestor(a))return zero;
    output[0]=1;NSError *error=nil;NSURL *result=nil;
    BOOL ok=[NSFileManager.defaultManager trashItemAtURL:reference resultingItemURL:&result error:&error];
    if(!ok){output[0]=4;return zero;}
    output[0]=2;
    const char *destination=result.path.fileSystemRepresentation;
    if(!destination||!same(destination,expected,directory))return two;
    size_t length=strlen(destination);if(length>=bytes-8)return two;
    memcpy((char *)memory+8,destination,length+1);output[1]=(uint32_t)length;output[0]=3;return one;
  }@catch(NSException *exception){(void)exception;return output[0]>=1?two:zero;}}
}
static napi_value initialize(napi_env env,napi_value exports){napi_property_descriptor property={"trashReferencedFile",NULL,trash,NULL,NULL,NULL,napi_default,NULL};if(napi_define_properties(env,exports,1,&property)!=napi_ok)return NULL;return exports;}
NAPI_MODULE(NODE_GYP_MODULE_NAME,initialize)
